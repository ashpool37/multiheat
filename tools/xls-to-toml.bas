Option Explicit

Sub ExportSpreadsheetToTOML()
    Dim oDoc As Object, oSheet As Object
    oDoc = ThisComponent
    oSheet = oDoc.CurrentController.ActiveSheet

    Dim sUrl As String
    sUrl = PickSaveFileURL("multiheat.toml")
    If sUrl = "" Then Exit Sub

    Dim sToml As String
    sToml = BuildTomlFromSheet(oSheet)

    WriteTextFileUTF8 sUrl, sToml
End Sub

Private Function BuildTomlFromSheet(oSheet As Object) As String
    Dim sb As String
    sb = ""
    sb = sb & "[multiheat]" & Chr(10)
    sb = sb & "version = ""0.0.1""" & Chr(10)
    sb = sb & "temp_unit = ""K""" & Chr(10)
    sb = sb & Chr(10)

    Dim lastRow As Long
    lastRow = GetLastUsedRow(oSheet)
    If lastRow < 0 Then
        BuildTomlFromSheet = sb
        Exit Function
    End If

    Dim mode As String ' "", "hot", "cold"
    mode = ""

    Dim r As Long
    For r = 0 To lastRow
        Dim c0 As String
        c0 = Trim$(GetCellString(oSheet, 0, r))

        If c0 = "" Then
            ' skip
        ElseIf c0 = "Горячие потоки" Then
            mode = "hot"
        ElseIf c0 = "Холодные потоки" Then
            mode = "cold"
        ElseIf Left$(c0, 8) = "Суммарна" Then
            mode = ""
        ElseIf mode <> "" Then
            Dim tin As String, tout As String, q As String, w As String, phase As String
            tin = ToTomlNumber(GetCellValueAsString(oSheet, 1, r))
            tout = ToTomlNumber(GetCellValueAsString(oSheet, 2, r))
            q = ToTomlNumber(GetCellValueAsString(oSheet, 3, r))
            w = ToTomlNumber(GetCellValueAsString(oSheet, 4, r))
            phase = Trim$(GetCellString(oSheet, 5, r))

            If tin <> "" Then
                sb = sb & "[[" & mode & "]]" & Chr(10)
                sb = sb & "in = " & tin & Chr(10)

                If phase <> "" Then
                    If q <> "" Then sb = sb & "load = " & q & Chr(10)
                Else
                    If tout <> "" Then sb = sb & "out = " & tout & Chr(10)
                    If w <> "" Then sb = sb & "rate = " & w & Chr(10)
                End If

                sb = sb & Chr(10)
            End If
        End If
    Next r

    BuildTomlFromSheet = sb
End Function

Private Function PickSaveFileURL(defaultName As String) As String
    On Error GoTo EH

    Dim fp As Object
    fp = CreateUnoService("com.sun.star.ui.dialogs.FilePicker")
    fp.initialize(Array(com.sun.star.ui.dialogs.TemplateDescription.FILESAVE_SIMPLE))

    fp.appendFilter("TOML (*.toml)", "*.toml")
    fp.setCurrentFilter("TOML (*.toml)")
    fp.setDefaultName(defaultName)

    If fp.execute() <> com.sun.star.ui.dialogs.ExecutableDialogResults.OK Then
        PickSaveFileURL = ""
        Exit Function
    End If

    Dim files As Variant
    files = fp.getFiles()
    If IsArray(files) Then
        PickSaveFileURL = files(0)
    Else
        PickSaveFileURL = ""
    End If
    Exit Function

EH:
    PickSaveFileURL = ""
End Function

Private Sub WriteTextFileUTF8(fileUrl As String, text As String)
    Dim oOut As Object, oText As Object
    oOut = CreateUnoService("com.sun.star.ucb.SimpleFileAccess")
    oText = CreateUnoService("com.sun.star.io.TextOutputStream")
    oText.setOutputStream(oOut.openFileWrite(fileUrl))
    oText.setEncoding("UTF-8")

    oText.writeString(text)
    oText.closeOutput()
End Sub

Private Function GetLastUsedRow(oSheet As Object) As Long
    Dim oCursor As Object
    oCursor = oSheet.createCursor()
    oCursor.gotoEndOfUsedArea(True)
    GetLastUsedRow = oCursor.RangeAddress.EndRow
End Function

Private Function GetCellString(oSheet As Object, col As Long, row As Long) As String
    Dim oCell As Object
    oCell = oSheet.getCellByPosition(col, row)
    GetCellString = oCell.getString()
End Function

Private Function GetCellValueAsString(oSheet As Object, col As Long, row As Long) As String
    Dim oCell As Object
    oCell = oSheet.getCellByPosition(col, row)

    If oCell.getType() = com.sun.star.table.CellContentType.VALUE Then
        GetCellValueAsString = CStr(oCell.getValue())
    Else
        GetCellValueAsString = Trim$(oCell.getString())
    End If
End Function

Private Function ToTomlNumber(s As String) As String
    s = Trim$(s)
    If s = "" Then
        ToTomlNumber = ""
        Exit Function
    End If

    s = Replace(s, ",", ".")
    ToTomlNumber = s
End Function
