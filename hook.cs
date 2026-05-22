using System;
using System.Diagnostics;
using System.IO;

class WizHook {
    static void Main(string[] args) {
        if (args.Length < 2) return;
        string wizDir = args[0];
        string script = args[1];
        string scriptArgs = "";
        for (int i = 2; i < args.Length; i++) {
            if (i > 2) scriptArgs += " ";
            scriptArgs += args[i];
        }

        string node = FindNode();
        if (node == null) return;

        string scriptPath = Path.Combine(wizDir, script);
        if (!File.Exists(scriptPath)) return;

        string nodeArgs = "\"" + scriptPath + "\"";
        if (scriptArgs.Length > 0) nodeArgs += " " + scriptArgs;

        Process.Start(new ProcessStartInfo(node, nodeArgs) {
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            UseShellExecute = false,
            WorkingDirectory = wizDir
        }).Dispose();
    }

    static string FindNode() {
        string localAppData = Environment.GetEnvironmentVariable("LOCALAPPDATA") ?? "";
        string[] candidates = {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs", "node.exe"),
        };
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
