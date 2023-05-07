# This script converts the aka.csv file to json files for checking into the repo
# This script along with Convert-AkaJsonToCsv is used to convert the json to csv format for easy editing in Excel
# The csv should not be checked in. The json files are the source of truth.


$filePath = $MyInvocation.MyCommand.Path
$folderPath = Split-Path $filePath -Parent
$configPath = $folderPath -replace "aka/build/scripts", "aka/website/config"
$csvFilePath = Join-Path $configPath "aka.csv"

function Get-AkaCustomObject ($item) {
    $akaLink = [PSCustomObject]@{
        linkName         = $item.linkName
        title            = $item.title
        autoCrawledTitle = $item.autoCrawledTitle
        keywords         = $item.keywords
        tags             = $item.tags
        linkUrl          = $item.linkUrl
    }
    return $akaLink
}

function Convert-AkaCsvToJson {
    Write-Host "Reading csv file from $csvFilePath"

    $csv = Import-Csv $csvFilePath

    $akaLinks = @{}

    foreach ($line in $csv) {   
        $akaLink = Get-AkaCustomObject $line
        $akaLinks.Add($akaLink.linkName, $akaLink)
        Write-ObjectToJsonFile $akaLink
    }
}

function Write-ObjectToJsonFile ($akaLink) {
    $jsonFileName = $akaLink.linkName -replace "/", ":"
    Write-Host "Writing to $jsonFileName.json"
    $akaLink | ConvertTo-Json | Out-File (Join-Path $configPath "$($jsonFileName).json") -Encoding utf8
}
function Convert-AkaJsonToCsv {
    Get-AllAkaFromFolder | Export-Csv $csvFilePath -Encoding utf8 -NoTypeInformation
}

function Get-AllAkaFromFolder {
    $jsonFiles = Get-ChildItem $configPath -Filter *.json

    $akaLinks = @{}
    foreach ($jsonFile in $jsonFiles) {
        Write-Host "Reading " $jsonFile.FullName
        $json = Get-Content $jsonFile.FullName | Out-String | ConvertFrom-Json

        $akaLink = Get-AkaCustomObject $json
        $akaLinks.Add($akaLink.linkName, $akaLink)
    }

    return $akaLinks
}
function Update-Urls {
    $akaLinks = Get-AllAkaFromFolder
    foreach($akaLink in $akaLinks.Values) {
        $request = Invoke-WebRequest -Uri "https://aka.ms/$($akaLink.linkName)" -Method Head
        $akaLink.linkUrl = $request.BaseResponse.ResponseUri.AbsoluteUri
    }

    foreach($akaLink in $akaLinks.Values) {
        Write-ObjectToJsonFile $akaLink
    }
}