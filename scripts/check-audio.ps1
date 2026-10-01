$code = @'
using System;
using System.Runtime.InteropServices;

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator {
    int NotImpl1();
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice);
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
    [PreserveSig] int OpenPropertyStore(int stgmAccess, out IntPtr ppProperties);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppstrId);
    [PreserveSig] int GetState(out int pdwState);
}

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr pNotify);
    int UnregisterControlChangeNotify(IntPtr pNotify);
    int GetChannelCount(out uint pnChannelCount);
    int SetMasterVolumeLevel(float fLevelDB, ref Guid pguidEventContext);
    [PreserveSig] int SetMasterVolumeLevelScalar(float fLevel, ref Guid pguidEventContext);
    int GetMasterVolumeLevel(out float pfLevelDB);
    [PreserveSig] int GetMasterVolumeLevelScalar(out float pfLevel);
    int SetChannelVolumeLevel(uint nChannel, float fLevelDB, ref Guid pguidEventContext);
    int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, ref Guid pguidEventContext);
    int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
    int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid pguidEventContext);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool pbMute);
}

public class AudioChecker {
    public static void CheckAndSet(float targetVolume) {
        Type enumeratorType = Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"));
        IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)Activator.CreateInstance(enumeratorType);
        IMMDevice dev;
        int hr = enumerator.GetDefaultAudioEndpoint(0, 1, out dev);
        if (hr != 0) {
            Console.WriteLine("GetDefaultAudioEndpoint failed: " + hr);
            return;
        }
        string id;
        dev.GetId(out id);
        int state;
        dev.GetState(out state);
        Guid iid = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
        object obj;
        dev.Activate(ref iid, 1, IntPtr.Zero, out obj);
        IAudioEndpointVolume vol = (IAudioEndpointVolume)obj;
        float level;
        vol.GetMasterVolumeLevelScalar(out level);
        bool mute;
        vol.GetMute(out mute);
        Console.WriteLine("DEFAULT_DEVICE_ID: " + id);
        Console.WriteLine("DEVICE_STATE: " + state);
        Console.WriteLine("CURRENT_RAW_LEVEL: " + level);
        Console.WriteLine("CURRENT_MASTER_VOLUME: " + (level * 100.0f) + "%");
        Console.WriteLine("CURRENT_MASTER_MUTED: " + mute);

        if (targetVolume >= 0.0f) {
            Guid empty = Guid.Empty;
            vol.SetMasterVolumeLevelScalar(targetVolume, ref empty);
            vol.SetMute(false, ref empty);
            vol.GetMasterVolumeLevelScalar(out level);
            vol.GetMute(out mute);
            Console.WriteLine("NEW_MASTER_VOLUME: " + (level * 100.0f) + "%");
            Console.WriteLine("NEW_MASTER_MUTED: " + mute);
        }
    }
}
'@

Add-Type -TypeDefinition $code
[AudioChecker]::CheckAndSet(0.80)
