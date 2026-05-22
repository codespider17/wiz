using System;
using System.Diagnostics;
using System.IO;

class Launcher {
    static void Main() {
        string dir = Path.GetDirectoryName(Environment.GetCommandLineArgs()[0]);
        string node = FindNode();
        if (node == null) return;

        string[] args = Environment.GetCommandLineArgs();
        if (args.Length < 2) return;

        string script = args[1];
        string scriptArgs = "";
        for (int i = 2; i < args.Length; i++) {
            if (i > 2) scriptArgs += " ";
            scriptArgs += args[i];
        }

        string scriptPath = Path.Combine(dir, script);
        if (!File.Exists(scriptPath)) return;

        string nodeArgs = "\"" + scriptPath + "\"";
        if (scriptArgs.Length > 0) nodeArgs += " " + scriptArgs;

        var psi = new ProcessStartInfo(node, nodeArgs) {
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            UseShellExecute = false,
            WorkingDirectory = dir,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            RedirectStandardInput = true
        };

        using (var p = Process.Start(psi)) {
            // Drain stdio to prevent console allocation for the node process.
            // Redirecting all three standard handles tells Windows this process
            // doesn't need a console — even though node.exe is a console subsystem
            // executable, CreateProcessW honors CREATE_NO_WINDOW when std handles
            // are explicitly provided.
            if (p != null) {
                p.StandardOutput.Close();
                p.StandardError.Close();
                p.StandardInput.Close();
            }
        }
    }

    static string FindNode() {
        string[] candidates = new string[] {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs", "node.exe"),
        };

        string localAppData = Environment.GetEnvironmentVariable("LOCALAPPDATA") ?? "";
        if (localAppData.Length > 0) {
            candidates = new string[] {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs", "node.exe"),
                Path.Combine(localAppData, "fnm", "node-versions", "current", "node.exe"),
            };
        }

        foreach (string c in candidates) {
            if (File.Exists(c)) return c;
        }

        string pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (string p in pathEnv.Split(';')) {
            try {
                string trimmed = p.Trim();
                if (trimmed.Length == 0) continue;
                string fp = Path.Combine(trimmed, "node.exe");
                if (File.Exists(fp)) return fp;
            } catch { }
        }

        return null;
    }
}
