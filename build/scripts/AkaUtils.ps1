# This script converts the aka.csv file to json files for checking into the repo
# This script along with Convert-AkaJsonToCsv is used to convert the json to csv format for easy editing in Excel
# The csv should not be checked in. The json files are the source of truth.


$filePath = $MyInvocation.MyCommand.Path
$folderPath = Split-Path $filePath -Parent
$configPath = $folderPath -replace "aka/build/scripts", "aka/website/config"
$csvFilePath = Join-Path $configPath "aka.csv"

function Convert-AkaCsvToJson {
    Write-Host "Reading csv file from $csvFilePath"

    $csv = Import-Csv $csvFilePath

    $akaLinks = @{}

    foreach ($line in $csv) {   
        $akaLink = [PSCustomObject]@{
            linkName = $line.linkName
            title = $line.title
            autoCrawledTitle = $line.autoCrawledTitle
            keywords = $line.keywords
            tags = $line.tags
            linkUrl = $line.linkUrl
        }
        $akaLinks.Add($akaLink.linkName, $akaLink)

        $jsonFileName = $akaLink.linkName -replace "/", ":"
        Write-Host "Writing to $jsonFileName.json"
        $akaLink | ConvertTo-Json | Out-File (Join-Path $configPath "$($jsonFileName).json") -Encoding utf8
    }
}

function Convert-AkaJsonToCsv {
    $jsonFiles = Get-ChildItem $configPath -Filter *.json

    $csv = @()
    foreach ($jsonFile in $jsonFiles) {
        Write-Host "Reading " $jsonFile.FullName
        $json = Get-Content $jsonFile.FullName | Out-String | ConvertFrom-Json
        $csvLine = [PSCustomObject]@{
            linkName = $json.linkName
            title = $json.title
            autoCrawledTitle = $json.autoCrawledTitle
            keywords = $json.keywords
            tags = $json.tags
            linkUrl = $json.linkUrl
        }
        $csv += $csvLine
    }

    $csv | Export-Csv $csvFilePath -Encoding utf8 -NoTypeInformation
}