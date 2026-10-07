// Out-of-band issuer. Not launched by the HTTP server, renderer, model or worker.
// Requires a separately provisioned non-admin Windows identity and an administrator-owned manifest.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

public static class ApprovalProtocol {
 public static readonly JavaScriptSerializer Json=new JavaScriptSerializer {MaxJsonLength=16384};
 public static string Canonical(object value) {
  if(value==null)return "null";
  var map=value as Dictionary<string,object>;
  if(map!=null) return "{"+String.Join(",",map.Keys.OrderBy(k=>k,StringComparer.Ordinal).Select(k=>Escape(k)+":"+Canonical(map[k])))+"}";
  var array=value as object[];if(array!=null)return "["+String.Join(",",array.Select(Canonical))+"]";
  if(value is string)return Escape((string)value);
  if(value is bool)return (bool)value?"true":"false";
  if(value is int || value is long)return Convert.ToString(value,System.Globalization.CultureInfo.InvariantCulture);
  throw new Exception("NON_CANONICAL_VALUE");
 }
 static string Escape(string value) {
  var b=new StringBuilder("\"");
  foreach(char c in value) {
   switch(c) {case '"':b.Append("\\\"");break;case '\\':b.Append("\\\\");break;
    case '\b':b.Append("\\b");break;case '\f':b.Append("\\f");break;case '\n':b.Append("\\n");break;
    case '\r':b.Append("\\r");break;case '\t':b.Append("\\t");break;
    default:if(c<32)b.Append("\\u"+((int)c).ToString("x4"));else b.Append(c);break;}
  }return b.Append('"').ToString();
 }
 public static string Hash(string text) {using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(text))).Replace("-","").ToLowerInvariant();}
 public static long Now() {return (long)(DateTime.UtcNow-new DateTime(1970,1,1)).TotalMilliseconds;}
 public static Dictionary<string,object> Validate(string canonical,string preview,object arguments,object scope,long now) {
  if(canonical.Length>12000 || preview.Length>500)throw new Exception("REQUEST_TOO_LARGE");
  if(preview.Any(c=>Char.IsControl(c)) || Regex.IsMatch(preview+Canonical(arguments)+Canonical(scope),"[\u202a-\u202e\u2066-\u2069]"))throw new Exception("AMBIGUOUS_REVIEW_TEXT");
  var p=Json.Deserialize<Dictionary<string,object>>(canonical);
  string[] keys={"version","issuer","nonce","issuedAt","expiresAt","secondConfirmation","goalId","graphId","nodeId","workerId","operation","attempt","tool","scopeHash","argumentHash","previewHash"};
  if(p==null || !p.Keys.OrderBy(k=>k).SequenceEqual(keys.OrderBy(k=>k)) || Canonical(p)!=canonical)throw new Exception("INVALID_CANONICAL_REQUEST");
  foreach(string name in new[]{"goalId","graphId","nodeId","workerId","operation","tool"})
   if(!(p[name] is string) || !Regex.IsMatch((string)p[name],@"\A[A-Za-z0-9_.:/-]{1,128}\z"))throw new Exception("INVALID_BINDING");
  foreach(string name in new[]{"nonce","scopeHash","argumentHash","previewHash"})
   if(!(p[name] is string) || !Regex.IsMatch((string)p[name],@"\A[0-9a-f]{64}\z"))throw new Exception("INVALID_HASH_OR_NONCE");
  long issued=Convert.ToInt64(p["issuedAt"]),expires=Convert.ToInt64(p["expiresAt"]);
  if(Convert.ToInt64(p["version"])!=1 || (string)p["issuer"]!="agenticos-interactive-issuer" ||
    !(p["secondConfirmation"] is bool) || !(bool)p["secondConfirmation"] || Convert.ToInt64(p["attempt"])<1 ||
    issued>now || expires<=now || expires<=issued || expires-issued>60000)throw new Exception("INVALID_OR_EXPIRED_APPROVAL");
  if((string)p["argumentHash"]!=Hash(Canonical(arguments)) || (string)p["scopeHash"]!=Hash(Canonical(scope)) ||
    (string)p["previewHash"]!=Hash(Canonical(preview)))throw new Exception("PREVIEW_OR_SCOPE_MISMATCH");
  if(Canonical(arguments).Length+Canonical(scope).Length>600)throw new Exception("REVIEW_PAYLOAD_TOO_LARGE");
  return p;
 }
 public static byte[] Sign(CngKey key,string canonical) {
  if(key.Algorithm!=CngAlgorithm.ECDsaP256 || key.ExportPolicy!=CngExportPolicies.None)throw new Exception("KEY_POLICY_INVALID");
  using(var signer=new ECDsaCng(key)) {signer.HashAlgorithm=CngAlgorithm.Sha256;return signer.SignData(Encoding.UTF8.GetBytes(canonical));}
 }
}

public static class ApprovalIssuer {
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct CredInfo {public int size;public IntPtr parent;public string message,caption;public IntPtr banner;}
 [DllImport("credui.dll",CharSet=CharSet.Unicode)]static extern uint CredUIPromptForWindowsCredentials(ref CredInfo info,uint error,ref uint package,IntPtr input,uint inputSize,out IntPtr output,out uint outputSize,ref bool save,uint flags);
 [DllImport("credui.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool CredUnPackAuthenticationBuffer(uint flags,IntPtr buffer,uint size,IntPtr user,ref uint userSize,IntPtr domain,ref uint domainSize,IntPtr password,ref uint passwordSize);
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool LogonUser(IntPtr user,IntPtr domain,IntPtr password,int type,int provider,out IntPtr token);
 [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr token);
 [DllImport("ole32.dll")]static extern void CoTaskMemFree(IntPtr buffer);
 static void Zero(IntPtr p,int size) {if(p!=IntPtr.Zero)for(int i=0;i<size;i++)Marshal.WriteByte(p,i,0);}
 static void Authenticate(string message,string operatorSid) {
  CredInfo info=new CredInfo {size=Marshal.SizeOf(typeof(CredInfo)),caption="AgenticOS independent approval",message=message};
  uint package=0,size=0;IntPtr packed=IntPtr.Zero,user=IntPtr.Zero,domain=IntPtr.Zero,password=IntPtr.Zero,token=IntPtr.Zero;bool save=false;
  uint us=1024,ds=1024,ps=1024;
  try {
   // Secure desktop only. Never accept command-line passwords or caller confirmation booleans.
   if(CredUIPromptForWindowsCredentials(ref info,0,ref package,IntPtr.Zero,0,out packed,out size,ref save,0x1000)!=0)throw new Exception("HUMAN_AUTHENTICATION_CANCELLED");
   user=Marshal.AllocHGlobal(2048);domain=Marshal.AllocHGlobal(2048);password=Marshal.AllocHGlobal(2048);
   if(!CredUnPackAuthenticationBuffer(0,packed,size,user,ref us,domain,ref ds,password,ref ps) ||
      !LogonUser(user,domain,password,2,0,out token))throw new Exception("HUMAN_AUTHENTICATION_FAILED");
   using(var identity=new WindowsIdentity(token))if(identity.User.Value!=operatorSid)throw new Exception("OPERATOR_IDENTITY_MISMATCH");
  } finally {
   Zero(packed,(int)size);if(packed!=IntPtr.Zero)CoTaskMemFree(packed);
   foreach(IntPtr p in new[]{user,domain,password}) {Zero(p,2048);if(p!=IntPtr.Zero)Marshal.FreeHGlobal(p);}
   if(token!=IntPtr.Zero)CloseHandle(token);
  }
 }
 internal static void ProtectedManifest(string file) {
  string current=Path.GetFullPath(file);
  string root=@"C:\ProgramData\AgenticOS-ApprovalIssuer";
  if(!String.Equals(current,Path.Combine(root,"issuer.json"),StringComparison.OrdinalIgnoreCase))throw new Exception("FIXED_MANIFEST_REQUIRED");
  while(current!=null) {
   if((File.GetAttributes(current)&FileAttributes.ReparsePoint)!=0)throw new Exception("MANIFEST_REPARSE_POINT");
   var security=Directory.Exists(current)?(FileSystemSecurity)Directory.GetAccessControl(current):File.GetAccessControl(current);
   string owner=security.GetOwner(typeof(SecurityIdentifier)).Value;
   if(owner!="S-1-5-18" && owner!="S-1-5-32-544")throw new Exception("MANIFEST_OWNER_NOT_TRUSTED");
   foreach(FileSystemAccessRule rule in security.GetAccessRules(true,true,typeof(SecurityIdentifier))) {
    const FileSystemRights write=FileSystemRights.Write|FileSystemRights.Delete|FileSystemRights.DeleteSubdirectoriesAndFiles|FileSystemRights.ChangePermissions|FileSystemRights.TakeOwnership;
    if(rule.AccessControlType==AccessControlType.Allow && (rule.FileSystemRights&write)!=0 &&
      rule.IdentityReference.Value!="S-1-5-18" && rule.IdentityReference.Value!="S-1-5-32-544")throw new Exception("MANIFEST_WRITABLE_BY_UNTRUSTED_IDENTITY");
   }
   if(String.Equals(current,root,StringComparison.OrdinalIgnoreCase)) {
    if(!security.AreAccessRulesProtected)throw new Exception("ISSUER_ROOT_INHERITANCE_NOT_PROTECTED");
    break;
   }
   current=Path.GetDirectoryName(current);
  }
 }
 internal static Dictionary<string,object> ReadManifest(string file) {
   ProtectedManifest(file);
   // Open without write/delete sharing; no ordinary identity may modify either manifest or parent.
   Dictionary<string,object> manifest;
   using(var stream=new FileStream(file,FileMode.Open,FileAccess.Read,FileShare.Read)) {
    if(stream.Length>8192)throw new Exception("MANIFEST_TOO_LARGE");
    using(var reader=new StreamReader(stream))manifest=ApprovalProtocol.Json.Deserialize<Dictionary<string,object>>(reader.ReadToEnd());
   }
   var denied=(object[])manifest["untrustedSids"];
   if(denied.Length<4)throw new Exception("IDENTITY_DENYLIST_INCOMPLETE");
   foreach(object sid in denied)new SecurityIdentifier((string)sid);
   new SecurityIdentifier((string)manifest["operatorSid"]);
   if(!Regex.IsMatch((string)manifest["keyName"],@"\AAgenticOS-Approval-[A-Za-z0-9-]{1,64}\z"))throw new Exception("INVALID_KEY_NAME");
   using(var identity=WindowsIdentity.GetCurrent()) {
    if(new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator) || identity.User.Value!=(string)manifest["issuerSid"])
      throw new Exception("ISOLATED_ISSUER_IDENTITY_REQUIRED");
    foreach(object sid in denied)if(identity.User.Value==(string)sid)throw new Exception("SHARED_IDENTITY_FORBIDDEN");
   }
   return manifest;
 }
 public static int Main(string[] args) {
  try {
   // No self-test, HTTP, pipe-approval, automatic enrollment, or test-key mode in this executable.
   if(args.Length!=1 || !Path.IsPathRooted(args[0]))throw new Exception("PROTECTED_MANIFEST_REQUIRED");
   var manifest=ReadManifest(args[0]);
   if(!Environment.UserInteractive || Process.GetCurrentProcess().SessionId==0)throw new Exception("TRUSTED_INTERACTIVE_SESSION_REQUIRED");
   // Existing per-user non-exportable CNG key only; never generate or enroll a real key implicitly.
   string keyName=(string)manifest["keyName"];
   if(!CngKey.Exists(keyName))throw new Exception("APPROVAL_KEY_UNAVAILABLE");
   using(var key=CngKey.Open(keyName)) {
    if(key.IsMachineKey || key.IsEphemeral || key.ExportPolicy!=CngExportPolicies.None ||
      key.Algorithm!=CngAlgorithm.ECDsaP256 ||
      ApprovalProtocol.Hash(Convert.ToBase64String(key.Export(CngKeyBlobFormat.EccPublicBlob)))!=(string)manifest["publicKeyBlobSha256"])
      throw new Exception("ENROLLED_KEY_IDENTITY_MISMATCH");
    var input=new StringBuilder();int ch;
    while((ch=Console.In.Read())!=-1 && ch!='\n') {if(input.Length>=16384)throw new Exception("INVALID_REQUEST");input.Append((char)ch);}
    if(ch==-1)throw new Exception("INVALID_REQUEST");string line=input.ToString();
    var request=ApprovalProtocol.Json.Deserialize<Dictionary<string,object>>(line);
    string canonical=(string)request["canonical"],preview=(string)request["preview"];
    var payload=ApprovalProtocol.Validate(canonical,preview,request["arguments"],request["scope"],ApprovalProtocol.Now());
    string summary="Tool: "+payload["tool"]+"\nWorker: "+payload["workerId"]+"\nGoal: "+payload["goalId"]+
      "\nGraph: "+payload["graphId"]+"\nNode: "+payload["nodeId"]+"\nAttempt: "+payload["attempt"]+
      "\nOperation: "+payload["operation"]+"\n"+preview+"\nScope: "+ApprovalProtocol.Canonical(request["scope"])+"\nArguments: "+ApprovalProtocol.Canonical(request["arguments"]);
    Authenticate(summary,(string)manifest["operatorSid"]);
    Authenticate("Confirm this exact approval a second time.\n"+summary+"\nRequest SHA256: "+ApprovalProtocol.Hash(canonical),(string)manifest["operatorSid"]);
    ApprovalProtocol.Validate(canonical,preview,request["arguments"],request["scope"],ApprovalProtocol.Now());
    Console.WriteLine(ApprovalProtocol.Json.Serialize(new {algorithm="ES256",canonical=canonical,signature=Convert.ToBase64String(ApprovalProtocol.Sign(key,canonical))}));
   }
   return 0;
  } catch {Console.Error.WriteLine("APPROVAL_ISSUANCE_REFUSED");return 1;}
 }
}
