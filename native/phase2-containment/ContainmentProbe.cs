// Reviewed disposable fixtures only. Bounded child creation; no external programs or user data.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public static class ContainmentProbe {
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct SI {
  public int cb; public string a,b,c;public int d,e,f,g,h,i,j,k;public short l,m;public IntPtr n,o,p,q;
 }
 [StructLayout(LayoutKind.Sequential)] struct PI {public IntPtr process,thread;public uint pid,tid;}
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder cmd,IntPtr a,IntPtr b,bool inherit,uint flags,IntPtr env,string cwd,ref SI si,out PI pi);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
 [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr h,uint code);
 [DllImport("kernel32.dll")] static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool result);
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr VirtualAlloc(IntPtr address,UIntPtr size,uint type,uint protection);
 [DllImport("user32.dll",SetLastError=true)] static extern bool OpenClipboard(IntPtr h);
 [DllImport("user32.dll")] static extern bool CloseClipboard();
 [DllImport("user32.dll",SetLastError=true)] static extern IntPtr GetClipboardData(uint format);
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateDesktop(string name,IntPtr device,IntPtr mode,uint flags,uint access,IntPtr security);
 [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr h);
 static string exe {get{return Process.GetCurrentProcess().MainModule.FileName;}}
 static int Child(string mode,bool breakaway) {
  SI si=new SI();si.cb=Marshal.SizeOf(si);PI p;
  bool ok=CreateProcess(exe,new StringBuilder("\""+exe+"\" "+mode),IntPtr.Zero,IntPtr.Zero,false,
   0x08000000|(breakaway?0x01000000u:0u),IntPtr.Zero,null,ref si,out p);
  if(!ok)return -Marshal.GetLastWin32Error();
  CloseHandle(p.thread);CloseHandle(p.process);return (int)p.pid;
 }
 public static int Main(string[] args) {
  string mode=args.Length==0?"marker":args[0];
  bool inside;IsProcessInJob(Process.GetCurrentProcess().Handle,IntPtr.Zero,out inside);
  File.WriteAllText("pid-"+Process.GetCurrentProcess().Id+".txt",mode+":"+inside);
  if(mode=="sleep"){Thread.Sleep(20000);return 0;}
  if(mode=="marker"){File.WriteAllText("executed.txt","executed");return 0;}
  if(mode=="spin"){while(true){} }
  if(mode=="memory"){
   long allocated=0;while(allocated<512L*1048576){IntPtr p=VirtualAlloc(IntPtr.Zero,new UIntPtr(8*1048576),0x3000,4);
    if(p==IntPtr.Zero){File.WriteAllText("memory-result.txt","MEMORY_DENIED:"+allocated);Console.WriteLine("MEMORY_DENIED:"+allocated);return 0;}Marshal.WriteByte(p,1);allocated+=8*1048576;}
   Console.WriteLine("MEMORY_UNBOUNDED");return 3;
  }
  if(mode=="jobmemory"){
   IntPtr p=VirtualAlloc(IntPtr.Zero,new UIntPtr(32*1048576),0x3000,4);if(p==IntPtr.Zero)return 7;
   int child=Child("memory",false);if(child<0)return 8;
   for(int i=0;i<500&&!File.Exists("memory-result.txt");i++)Thread.Sleep(10);
   if(!File.Exists("memory-result.txt"))return 9;
   Console.WriteLine(File.ReadAllText("memory-result.txt"));return 0;
  }
  if(mode=="saturate"){
   int admitted=0,denied=0;for(int i=0;i<12;i++){int p=Child("sleep",false);if(p>0)admitted++;else denied++;}
   Console.WriteLine("ADMITTED:"+admitted+" DENIED:"+denied);return denied>0?0:4;
  }
  if(mode=="grandparent"){int p=Child("parent",false);File.WriteAllText("ready.txt",p.ToString());Thread.Sleep(20000);return 0;}
  if(mode=="parent"){Child("sleep",false);Thread.Sleep(20000);return 0;}
  if(mode=="breakaway"){
   int pid=Child("sleep",true);Console.WriteLine("BREAKAWAY:"+pid);
   if(pid>0){try{Process.GetProcessById(pid).Kill();}catch{}return 5;}return 0;
  }
  if(mode=="ui"){
   // No clipboard content is read/dereferenced; no input, focus, display or desktop switching.
   bool opened=OpenClipboard(IntPtr.Zero);IntPtr data=GetClipboardData(13);int clipboardError=Marshal.GetLastWin32Error();if(opened)CloseClipboard();
   IntPtr desktop=CreateDesktop("Phase2Disposable-"+Process.GetCurrentProcess().Id,IntPtr.Zero,IntPtr.Zero,0,0x10000000,IntPtr.Zero);
   int desktopError=Marshal.GetLastWin32Error();if(desktop!=IntPtr.Zero)CloseDesktop(desktop);
   Console.WriteLine("CLIPBOARD_HANDLE:"+data.ToInt64()+" ERROR:"+clipboardError+" DESKTOP_HANDLE:"+desktop.ToInt64()+" ERROR:"+desktopError);
   return data==IntPtr.Zero&&clipboardError==5&&desktop==IntPtr.Zero&&desktopError==5?0:6;
  }
  return 9;
 }
}
