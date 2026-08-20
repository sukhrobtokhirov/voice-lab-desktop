!macro customHeader
  ManifestDPIAware true
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    StrCpy $0 "$PROFILE\.cache\voicelab\models"
    IfFileExists "$0\*.*" 0 +3
      RMDir /r "$0"
      DetailPrint "Removed VoiceLab cached models"
    StrCpy $1 "$PROFILE\.cache\voicelab"
    RMDir "$1"

    ; Remove the pre-VoiceLab model cache during uninstall as well.
    StrCpy $0 "$PROFILE\.cache\openwhispr\models"
    IfFileExists "$0\*.*" 0 +3
      RMDir /r "$0"
      DetailPrint "Removed legacy VoiceLab cached models"
    StrCpy $1 "$PROFILE\.cache\openwhispr"
    RMDir "$1"
  ${endIf}
!macroend
