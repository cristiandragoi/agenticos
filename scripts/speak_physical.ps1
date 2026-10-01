param (
    [string]$Text = "Jarvis, what is the status of Free Cash?"
)
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice("Microsoft Zira Desktop")
$synth.Rate = -1
$synth.Volume = 100
$synth.Speak($Text)
