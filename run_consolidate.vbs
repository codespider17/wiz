Set ws = CreateObject("WScript.Shell")
Set proc = ws.Exec("cmd /c start /B launcher.exe consolidate.js")
proc.StdIn.Close
proc.StdOut.Close
proc.StdErr.Close
