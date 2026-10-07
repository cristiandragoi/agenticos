// Explicit offline enrollment utility. Never invoked by application startup or tests.
// Must run as the already-provisioned isolated issuer with an admin-owned bootstrap manifest.
using System;
using System.Security.Cryptography;
public static class ApprovalEnroll {
 public static int Main(string[] args) {
  try {
   if(args.Length!=1)throw new Exception("PROTECTED_MANIFEST_REQUIRED");
   var manifest=ApprovalIssuer.ReadManifest(args[0]);
   if(!String.IsNullOrEmpty((string)manifest["publicKeyBlobSha256"]))throw new Exception("ALREADY_ENROLLED");
   string name=(string)manifest["keyName"];
   if(CngKey.Exists(name))throw new Exception("KEY_ALREADY_EXISTS_REVIEW_REQUIRED");
   using(var key=CngKey.Create(CngAlgorithm.ECDsaP256,name,new CngKeyCreationParameters {ExportPolicy=CngExportPolicies.None})) {
    string publicBlob=Convert.ToBase64String(key.Export(CngKeyBlobFormat.EccPublicBlob));
    Console.WriteLine(ApprovalProtocol.Json.Serialize(new {algorithm="ES256",publicBlob=publicBlob,
      publicKeyBlobSha256=ApprovalProtocol.Hash(publicBlob),exportPolicy="None",issuerSid=manifest["issuerSid"]}));
   }
   return 0;
  } catch {Console.Error.WriteLine("APPROVAL_ENROLLMENT_REFUSED");return 1;}
 }
}
