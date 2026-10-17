param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('set', 'get', 'delete')]
    [string]$Action
)

$ErrorActionPreference = 'Stop'
$targetName = 'UCA-LMS-Agent/ucasaslms.org'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class WinCredentialManager
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CREDENTIAL
    {
        public uint Flags;
        public uint Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWrite(ref CREDENTIAL credential, uint flags);

    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credentialPtr);

    [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredDelete(string target, uint type, uint flags);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern void CredFree(IntPtr buffer);

    private const uint Generic = 1;
    private const uint PersistLocalMachine = 2;
    private const int NotFound = 1168;

    public static void Write(string target, string username, string password)
    {
        IntPtr blob = Marshal.StringToCoTaskMemUni(password);
        try
        {
            var credential = new CREDENTIAL {
                Type = Generic,
                TargetName = target,
                UserName = username,
                CredentialBlob = blob,
                CredentialBlobSize = (uint)(password.Length * 2),
                Persist = PersistLocalMachine
            };
            if (!CredWrite(ref credential, 0)) {
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            }
        }
        finally
        {
            Marshal.ZeroFreeCoTaskMemUnicode(blob);
        }
    }

    public static string[] Read(string target)
    {
        IntPtr pointer;
        if (!CredRead(target, Generic, 0, out pointer)) {
            int error = Marshal.GetLastWin32Error();
            if (error == NotFound) return null;
            throw new System.ComponentModel.Win32Exception(error);
        }
        try
        {
            var credential = (CREDENTIAL)Marshal.PtrToStructure(pointer, typeof(CREDENTIAL));
            string password = credential.CredentialBlobSize == 0
                ? ""
                : Marshal.PtrToStringUni(credential.CredentialBlob, (int)credential.CredentialBlobSize / 2);
            return new [] { credential.UserName, password };
        }
        finally
        {
            CredFree(pointer);
        }
    }

    public static bool Delete(string target)
    {
        if (CredDelete(target, Generic, 0)) return true;
        int error = Marshal.GetLastWin32Error();
        if (error == NotFound) return false;
        throw new System.ComponentModel.Win32Exception(error);
    }
}
'@

switch ($Action) {
    'set' {
        $username = Read-Host 'UCA LMS username'
        if ([string]::IsNullOrWhiteSpace($username)) { throw 'Username cannot be empty.' }
        $securePassword = Read-Host 'UCA LMS password' -AsSecureString
        $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
        try {
            $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
            [WinCredentialManager]::Write($targetName, $username, $password)
        }
        finally {
            if ($null -ne $password) { $password = $null }
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
        }
        Write-Output 'Credentials stored in Windows Credential Manager.'
    }
    'get' {
        # Machine-readable output is consumed only by the local Node process.
        # Never run this action manually or forward its stdout to a model/log.
        $credential = [WinCredentialManager]::Read($targetName)
        if ($null -eq $credential) { exit 4 }
        @{ username = $credential[0]; password = $credential[1] } |
            ConvertTo-Json -Compress
    }
    'delete' {
        $deleted = [WinCredentialManager]::Delete($targetName)
        if ($deleted) { Write-Output 'Credentials deleted.' }
        else { Write-Output 'No stored credentials were found.' }
    }
}
