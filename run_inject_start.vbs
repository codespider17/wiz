Set ws = CreateObject("WScript.Shell")
Set proc = ws.Exec("cmd /c start /B launcher.exe inject.js --session-start")
proc.StdIn.Close
proc.StdOut.Close
proc.StdErr.Close
