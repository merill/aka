# This script converts the aka.csv file to json files for checking into the repo
# This script along with Convert-AkaJsonToCsv is used to convert the json to csv format for easy editing in Excel
# The csv should not be checked in. The json files are the source of truth.


$filePath = $MyInvocation.MyCommand.Path
$folderPath = Split-Path $filePath -Parent
$configPath = $folderPath -replace "aka/build/scripts", "aka/website/config"
$csvFilePath = Join-Path $configPath "aka.csv"

function Get-AkaCustomObject ($item) {
    $akaLink = [PSCustomObject]@{
        link             = $item.link
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

    $akaLinks = @()

    foreach ($line in $csv) {   
        $akaLink = Get-AkaCustomObject $line
        $akaLinks += $akaLink
        Write-ObjectToJsonFile $akaLink
    }
}

function Write-ObjectToJsonFile ($akaLink) {
    $jsonFileName = $akaLink.link -replace "/", ":"
    Write-Host "Writing to $jsonFileName.json"
    $akaLink | ConvertTo-Json | Out-File (Join-Path $configPath "$($jsonFileName).json") -Encoding utf8
}
function Convert-AkaJsonToCsv {
    Get-AllAkaFromFolder | Export-Csv $csvFilePath -Encoding utf8 -NoTypeInformation
}

function Get-AllAkaFromFolder {
    $jsonFiles = Get-ChildItem $configPath -Filter *.json

    $akaLinks = @()
    foreach ($jsonFile in $jsonFiles) {
        Write-Host "Reading " $jsonFile.FullName
        $json = Get-Content $jsonFile.FullName | Out-String | ConvertFrom-Json

        $akaLink = Get-AkaCustomObject $json
        $akaLinks += $akaLink
    }

    return $akaLinks
}
function Update-Urls {
    $akaLinks = Get-AllAkaFromFolder
    foreach ($akaLink in $akaLinks) {
        Write-Host "Update url: https://aka.ms/"$akaLink.link
        $request = Invoke-WebRequest -Uri "https://aka.ms/$($akaLink.link)" -Method Head -MaximumRedirection 0 -ErrorAction Ignore -SkipHttpErrorCheck
        if ($request.Headers.Location) {
            $uri = $request.Headers.Location[0]
            if($uri -like "https://www.bing.com/?ref=aka*") {
                Write-Error "aka.ms/$($akaLink.link) is not a valid aka.ms link."
            }
            else {
                $akaLink.linkUrl = $uri
            }
        }

        Write-ObjectToJsonFile $akaLink
    }
}

function Update-Title {
    $akaLinks = Get-AllAkaFromFolder
    foreach ($akaLink in $akaLinks) {
        Write-Host "Update title: https://aka.ms/"$akaLink.link
        $request = Invoke-WebRequest -Uri "https://aka.ms/$($akaLink.link)" -UseBasicParsing
        
        if($request.Content -match "<title>(?<title>.*)</title>") {
            $title = $Matches.title
            if($title -ne "Sign in to your account") {
                $akaLink.autoCrawledTitle = $Matches.title
                Write-ObjectToJsonFile $akaLink    
            }
        }
    }
}

function Update-All {
    Update-Urls
    Update-Title
}