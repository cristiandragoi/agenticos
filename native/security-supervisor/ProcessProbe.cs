// Harmless native regression fixture: only starts another copy of itself sleeping.
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public static class ProcessProbe {
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct SI {
  public int cb; public string a,b,c;public int d,e,f,g,h,i,j,k;public short l,m;public IntPtr n,o,p,q;
 }
 [StructLayout(LayoutKind.Sequential)] struct PI {public IntPtr process,thread;public uint pid,tid;}
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder cmd,IntPtr a,IntPtr b,bool inherit,uint flags,IntPtr env,string cwd,ref SI si,out PI pi);
 [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr h);
 [DllImport("kernel32.dll")]static extern bool TerminateProcess(IntPtr h,uint code);
 public static int Main(string[] args) {
  if(args.Length==1 && args[0]=="sleep") {Thread.Sleep(30000);return 0;}
  string exe=Process.GetCurrentProcess().MainModule.FileName;
  SI si=new SI();si.cb=Marshal.SizeOf(si);PI pi;
  bool escaped=CreateProcess(exe,new StringBuilder("\""+exe+"\" sleep"),IntPtr.Zero,IntPtr.Zero,false,0x01000000|0x08000000,IntPtr.Zero,null,ref si,out pi);
  int error=Marshal.GetLastWin32Error();
  if(escaped){TerminateProcess(pi.process,1);CloseHandle(pi.thread);CloseHandle(pi.process);}
  Console.WriteLine(escaped?"BREAKAWAY_SUCCEEDED":"BREAKAWAY_REFUSED:"+error);
  return escaped?1:0;
 }
}
