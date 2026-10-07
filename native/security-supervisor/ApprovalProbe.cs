// Separate test executable: ephemeral non-exportable key only; never opens a named production key or UI.
using System;
using System.Security.Cryptography;
public static class ApprovalProbe {
 public static int Main() {
  try {
   var req=ApprovalProtocol.Json.Deserialize<System.Collections.Generic.Dictionary<string,object>>(Console.ReadLine());
   string canonical=(string)req["canonical"];
   ApprovalProtocol.Validate(canonical,(string)req["preview"],req["arguments"],req["scope"],Convert.ToInt64(req["now"]));
   using(var key=CngKey.Create(CngAlgorithm.ECDsaP256,null,new CngKeyCreationParameters {ExportPolicy=CngExportPolicies.None})) {
    bool privateExportDenied=false;
    try {key.Export(CngKeyBlobFormat.EccPrivateBlob);}catch(CryptographicException){privateExportDenied=true;}
    if(!privateExportDenied)throw new Exception("PRIVATE_EXPORT_ALLOWED");
    Console.WriteLine(ApprovalProtocol.Json.Serialize(new {publicBlob=Convert.ToBase64String(key.Export(CngKeyBlobFormat.EccPublicBlob)),
      signature=Convert.ToBase64String(ApprovalProtocol.Sign(key,canonical)),privateExportDenied=privateExportDenied}));
   }return 0;
  }catch{Console.Error.WriteLine("PROBE_REFUSED");return 1;}
 }
}
