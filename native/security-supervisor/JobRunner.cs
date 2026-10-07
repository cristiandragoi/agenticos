// Windows process lifetime boundary, NOT a filesystem/network sandbox.
// Protocol: one JSON request line, then keep stdin open. EOF or any further input cancels.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

public static class JobRunner {
    [StructLayout(LayoutKind.Sequential)] struct SA { public int length; public IntPtr descriptor; public int inherit; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct SI {
        public int cb; public string reserved, desktop, title;
        public int x,y,xSize,ySize,xChars,yChars,fill,flags;
        public short show,reservedSize; public IntPtr reservedPointer,input,output,error;
    }
    [StructLayout(LayoutKind.Sequential)] struct SIX { public SI si; public IntPtr attributes; }
    [StructLayout(LayoutKind.Sequential)] struct PI { public IntPtr process,thread; public uint pid,tid; }
    [StructLayout(LayoutKind.Sequential)] struct BasicLimit {
        public long processTime,jobTime; public uint flags; public UIntPtr minWorkingSet,maxWorkingSet;
        public uint activeLimit; public UIntPtr affinity; public uint priority,scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong a,b,c,d,e,f; }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimit {
        public BasicLimit basic; public IoCounters io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob;
    }
    [StructLayout(LayoutKind.Sequential)] struct Accounting {
        public long user,kernel,periodUser,periodKernel; public uint faults,total,active,terminated;
    }
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr sa,string name);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref ExtendedLimit info,uint size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int kind,out Accounting info,uint size,IntPtr returned);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool CreatePipe(out IntPtr read,out IntPtr write,ref SA sa,int size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle,uint mask,uint flags);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateFile(string file,uint access,uint share,ref SA sa,uint creation,uint flags,IntPtr template);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder command,IntPtr psa,IntPtr tsa,bool inherit,uint flags,IntPtr env,string cwd,ref SIX startup,out PI process);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint ms);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

    public sealed class Request {
        public string executable {get;set;} public string executableSha256 {get;set;} public string cwd {get;set;}
        public string[] args {get;set;} public Dictionary<string,string> env {get;set;}
        public int timeoutMs {get;set;} public int maxOutputBytes {get;set;}
    }
    static void Check(bool ok) { if(!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    static void Close(ref IntPtr handle) { if(handle!=IntPtr.Zero && handle!=new IntPtr(-1)) CloseHandle(handle); handle=IntPtr.Zero; }
    static string Quote(string value) {
        if(value==null || value.IndexOf('\0')>=0) throw new Exception("INVALID_ARGUMENT");
        StringBuilder s=new StringBuilder("\""); int slashes=0;
        foreach(char c in value) { if(c=='\\') {slashes++;continue;} if(c=='\"') s.Append('\\',slashes*2+1); else s.Append('\\',slashes); s.Append(c);slashes=0; }
        s.Append('\\',slashes*2); return s.Append('"').ToString();
    }
    static string ReadRequest() {
        StringBuilder b=new StringBuilder(); int c;
        while((c=Console.In.Read())!=-1 && c!='\n') { if(b.Length>=65536) throw new Exception("REQUEST_LIMIT"); b.Append((char)c); }
        if(c==-1) throw new Exception("SUPERVISOR_DISCONNECTED"); return b.ToString();
    }
    public static int Main() {
        var json=new JavaScriptSerializer {MaxJsonLength=1000000};
        IntPtr job=IntPtr.Zero,read=IntPtr.Zero,write=IntPtr.Zero,input=IntPtr.Zero,attrs=IntPtr.Zero,handles=IntPtr.Zero,jobHandles=IntPtr.Zero,envBlock=IntPtr.Zero;
        PI pi=new PI(); bool assigned=false; int cancelled=0,overflow=0; FileStream binaryLock=null;
        var output=new MemoryStream(); Thread reader=null; Exception readError=null;
        try {
            Request r=json.Deserialize<Request>(ReadRequest());
            if(r==null || !Path.IsPathRooted(r.executable??"") || !Path.IsPathRooted(r.cwd??"") || r.args==null || r.args.Length>100 || r.env==null ||
               r.timeoutMs<1 || r.timeoutMs>60000 || r.maxOutputBytes<1 || r.maxOutputBytes>1048576) throw new Exception("INVALID_REQUEST");
            // Hold the binary open without write/delete sharing through execution.
            binaryLock=new FileStream(r.executable,FileMode.Open,FileAccess.Read,FileShare.Read);
            using(var sha=SHA256.Create()) {
                string actual=BitConverter.ToString(sha.ComputeHash(binaryLock)).Replace("-","").ToLowerInvariant();
                if(!String.Equals(actual,r.executableSha256,StringComparison.Ordinal)) throw new Exception("EXECUTABLE_IDENTITY_MISMATCH");
            }
            job=CreateJobObject(IntPtr.Zero,null); Check(job!=IntPtr.Zero);
            ExtendedLimit limits=new ExtendedLimit();
            limits.basic.flags=0x2000|0x8|0x200; // KILL_ON_JOB_CLOSE | ACTIVE_PROCESS | JOB_MEMORY. No BREAKAWAY flags.
            limits.basic.activeLimit=8; limits.jobMemory=new UIntPtr(1073741824);
            Check(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(limits)));
            SA sa=new SA {length=Marshal.SizeOf(typeof(SA)),inherit=1};
            Check(CreatePipe(out read,out write,ref sa,0)); Check(SetHandleInformation(read,1,0));
            input=CreateFile("NUL",0x80000000,3,ref sa,3,0,IntPtr.Zero); Check(input!=new IntPtr(-1));
            IntPtr bytes=IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero,2,0,ref bytes);
            attrs=Marshal.AllocHGlobal(bytes); Check(InitializeProcThreadAttributeList(attrs,2,0,ref bytes));
            handles=Marshal.AllocHGlobal(IntPtr.Size*2); Marshal.WriteIntPtr(handles,0,input);Marshal.WriteIntPtr(handles,IntPtr.Size,write);
            Check(UpdateProcThreadAttribute(attrs,0,new IntPtr(0x20002),handles,new IntPtr(IntPtr.Size*2),IntPtr.Zero,IntPtr.Zero));
            jobHandles=Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobHandles,0,job);
            Check(UpdateProcThreadAttribute(attrs,0,new IntPtr(0x2000D),jobHandles,new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero));
            StringBuilder environment=new StringBuilder(); var names=new List<string>(r.env.Keys);names.Sort(StringComparer.OrdinalIgnoreCase);
            var seen=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach(string key in names) {
                if(!seen.Add(key) || key.Length==0 || key.IndexOfAny(new char[]{'=','\0'})>=0 || r.env[key]==null || r.env[key].IndexOf('\0')>=0) throw new Exception("INVALID_ENVIRONMENT");
                environment.Append(key).Append('=').Append(r.env[key]).Append('\0');
            }
            environment.Append('\0');envBlock=Marshal.StringToHGlobalUni(environment.ToString());
            StringBuilder command=new StringBuilder(Quote(r.executable));foreach(string arg in r.args)command.Append(' ').Append(Quote(arg));
            if(command.Length>30000)throw new Exception("COMMAND_LIMIT");
            SIX startup=new SIX();startup.si.cb=Marshal.SizeOf(typeof(SIX));startup.si.flags=0x100;startup.si.input=input;startup.si.output=write;startup.si.error=write;startup.attributes=attrs;
            Check(CreateProcess(r.executable,command,IntPtr.Zero,IntPtr.Zero,true,0x4|0x400|0x8000000|0x80000,envBlock,r.cwd,ref startup,out pi));
            Check(AssignProcessToJobObject(job,pi.process)); assigned=true;
            Close(ref write); Close(ref input);
            IntPtr pipe=read;read=IntPtr.Zero;
            reader=new Thread(delegate() {
                try {using(var stream=new FileStream(new SafeFileHandle(pipe,true),FileAccess.Read,4096,false)) {
                    byte[] buffer=new byte[4096];int n;
                    while((n=stream.Read(buffer,0,buffer.Length))>0) {
                        lock(output) { int remaining=r.maxOutputBytes-(int)output.Length;output.Write(buffer,0,Math.Min(n,remaining));
                            if(n>remaining)Interlocked.Exchange(ref overflow,1); }
                    }
                }} catch(Exception ex) {readError=ex;}
            });reader.IsBackground=true;reader.Start();
            var watch=new Thread(delegate() { Console.In.Read();Interlocked.Exchange(ref cancelled,1); });watch.IsBackground=true;watch.Start();
            Check(ResumeThread(pi.thread)!=0xffffffff);Close(ref pi.thread);
            Stopwatch clock=Stopwatch.StartNew();bool timedOut=false;
            while(WaitForSingleObject(pi.process,10)!=0) {
                if(clock.ElapsedMilliseconds>=r.timeoutMs) {timedOut=true;break;}
                if(Volatile.Read(ref cancelled)!=0 || Volatile.Read(ref overflow)!=0)break;
            }
            uint exitCode;Check(GetExitCodeProcess(pi.process,out exitCode));
            // Kill all descendants even if root exited normally, then prove job active-process count is zero.
            Check(TerminateJobObject(job,1));
            Accounting accounting; Stopwatch cleanup=Stopwatch.StartNew();
            do { Check(QueryInformationJobObject(job,1,out accounting,(uint)Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero));
                if(accounting.active==0)break;Thread.Sleep(10);
            } while(cleanup.ElapsedMilliseconds<2000);
            if(accounting.active!=0)throw new Exception("OS_CLEANUP_UNCONFIRMED");
            if(!reader.Join(2000) || readError!=null)throw new Exception("OUTPUT_DRAIN_UNCONFIRMED");
            string reason=timedOut?"TIMEOUT":cancelled!=0?"CANCELLED":overflow!=0?"OUTPUT_LIMIT":"EXITED";
            Console.WriteLine(json.Serialize(new {reason=reason,exitCode=exitCode,pid=pi.pid,activeProcesses=accounting.active,
                totalProcesses=accounting.total,assignedBeforeResume=true,atomicJobList=true,killOnClose=true,outputBase64=Convert.ToBase64String(output.ToArray())}));
            return reason=="EXITED"?0:2;
        } catch(Exception ex) {
            if(assigned && job!=IntPtr.Zero)TerminateJobObject(job,1);
            else if(pi.process!=IntPtr.Zero)TerminateProcess(pi.process,1);
            Console.WriteLine(json.Serialize(new {reason="REFUSED",error=ex.Message}));return 1;
        } finally {
            Close(ref job);Close(ref pi.thread);Close(ref pi.process);Close(ref read);Close(ref write);Close(ref input);
            if(attrs!=IntPtr.Zero){DeleteProcThreadAttributeList(attrs);Marshal.FreeHGlobal(attrs);}
            if(handles!=IntPtr.Zero)Marshal.FreeHGlobal(handles);if(jobHandles!=IntPtr.Zero)Marshal.FreeHGlobal(jobHandles);if(envBlock!=IntPtr.Zero)Marshal.FreeHGlobal(envBlock);
            if(binaryLock!=null)binaryLock.Dispose();
        }
    }
}
