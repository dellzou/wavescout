Option Explicit

' ============================================================
'  WaveScout - Launcher
'  Double-click this file to open the app in a borderless
'  application window (Edge / Chrome --app mode).
' ============================================================

Dim fso, sh, baseFolder, indexPath, browserExe, pageUrl, launchCmd

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")

Function FindBrowser()
  Dim pf, pf86, cand, i
  pf   = sh.ExpandEnvironmentStrings("%ProgramFiles%")
  pf86 = sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%")

  cand = Array( _
    pf86 & "\Microsoft\Edge\Application\msedge.exe", _
    pf   & "\Microsoft\Edge\Application\msedge.exe", _
    pf86 & "\Google\Chrome\Application\chrome.exe", _
    pf   & "\Google\Chrome\Application\chrome.exe", _
    pf86 & "\Microsoft\Edge Beta\Application\msedge.exe" )

  For i = 0 To UBound(cand)
    If fso.FileExists(cand(i)) Then
      FindBrowser = cand(i)
      Exit Function
    End If
  Next

  FindBrowser = ""
End Function

baseFolder = fso.GetParentFolderName(WScript.ScriptFullName)
indexPath  = baseFolder & "\index.html"

If Not fso.FileExists(indexPath) Then
  MsgBox "index.html was not found in:" & vbCrLf & baseFolder & vbCrLf & vbCrLf & _
         "Please keep this launcher in the same folder as index.html.", _
         16, "WaveScout"
  WScript.Quit
End If

browserExe = FindBrowser()

pageUrl = "file:///" & Replace(indexPath, "\", "/")
pageUrl = Replace(pageUrl, " ", "%20")
pageUrl = Replace(pageUrl, "#", "%23")

If browserExe = "" Then
  ' Fallback: hand the file to the system default browser
  sh.Run pageUrl, 1, False
Else
  launchCmd = """" & browserExe & """ --app=""" & pageUrl & """ --window-size=1560,980 --no-first-run"
  sh.Run launchCmd, 1, False
End If

WScript.Quit
