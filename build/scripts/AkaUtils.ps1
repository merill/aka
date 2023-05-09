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
        category         = $item.category
        url              = $item.url
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
    Write-Host "Json files created at $configPath"
}

function Write-AkaObjectToJsonFile ($akaLink) {
    $jsonFileName = $akaLink.link.ToLower() -replace "/", ":"
    Write-Host "Writing to $jsonFileName.json"
    $akaLink | ConvertTo-Json | Out-File (Join-Path $configPath "$($jsonFileName).json") -Encoding utf8
}
function Convert-AkaJsonToCsv {
    Get-AkaJsonsFromFolder | Export-Csv $csvFilePath -Encoding utf8 -NoTypeInformation
    Write-Host "Csv created at $csvFilePath"
}

function Get-AkaJsonsFromFolder {
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
function Update-AkaUrls {
    $akaLinks = Get-AkaJsonsFromFolder
    foreach ($akaLink in $akaLinks) {

        Write-Host "Update url: https://aka.ms/"$akaLink.link
        $longUrl = Get-AkaLongUrl $akaLink.link
        if($longUrl) {
            $akaLink.url = $longUrl

            Write-AkaObjectToJsonFile $akaLink
        }        
    }
}

function Get-AkaLongUrl($akaLinkName) {
    Write-Host "Get url: https://aka.ms/"$akaLinkName
    $request = Invoke-WebRequest -Uri "https://aka.ms/$($akaLinkName)" -Method Head -MaximumRedirection 0 -ErrorAction Ignore -SkipHttpErrorCheck
    $result = $null
    if ($request.Headers.Location) {
        $uri = $request.Headers.Location[0]
        if($uri -like "https://www.bing.com/?ref=aka*") {
            Write-Host "Warning: aka.ms/$($akaLinkName) is not a valid aka.ms link."
        }
        else {
            $result = $uri
        }
    }
    return $result
}

function Get-AkaTitle($akaLinkName) {
    Write-Host "Get title: https://aka.ms/"$akaLinkName
    $request = Invoke-WebRequest -Uri "https://aka.ms/$($akaLinkName)" -UseBasicParsing
    $result = ""
    if($request.Content -match "<title>(?<title>.*)</title>") {
        $result = $Matches.title
        if($title -ne "Sign in to your account") {
            $result = $Matches.title
        }
    }
    return $result
}
function Update-AkaTitle {
    $akaLinks = Get-AkaJsonsFromFolder
    foreach ($akaLink in $akaLinks) {
        Write-Host "Update title: https://aka.ms/"$akaLink.link
        $title = Get-AkaTitle $akaLink.link
        if($title) {
            $akaLink.autoCrawledTitle = $title
            Write-AkaObjectToJsonFile $akaLink
        }
    }
}

function Update-AkaAll {
    Update-AkaUrls
    Update-AkaTitle
}

function Set-AkaGitHubAuth(){
    $token = $env:GITHUB_TOKEN
    if([string]::IsNullOrEmpty($token)) {
        Write-Error "GITHUB_TOKEN environment variable is not set. Please set it to a valid GitHub token."
    }
    else {
        $secureString = ConvertTo-SecureString -String $token -AsPlainText -Force
        $cred = New-Object System.Management.Automation.PSCredential "username is ignored", $secureString
        Set-GitHubAuthentication -Credential $cred -SessionOnly
    }
}

function New-AkaLinkFromIssue {
    param(
        [Parameter(Mandatory=$true)]
        [string]$issueNumber
    )
    $issue = Get-GitHubIssue  -Issue $issueNumber -OwnerName merill -RepositoryName aka

    $lines = $issue.body.Split([Environment]::NewLine)

    $link = $lines[2]
    $category = $lines[6]
    if($category -eq "None") {
        $category = $null
    }

    $link = $link -replace "https://aka.ms/", ""
    $link = $link -replace "http://aka.ms/", ""
    $link = $link.Trim()

    $longUrl = Get-AkaLongUrl $link

    if([string]::IsNullOrEmpty($link) -or !$longUrl){
        $message = "Thank you for submitting an aka.ms link. Unfortunately the link [https://aka.ms/$link](https://aka.ms/$link) is not a valid aka.ms link. If you believe this is a mistake, it could be a problem with the automated script. Please reach out to me at https://twitter.com/merill and let me know. Thanks!"
        Write-Host $message
        New-GitHubIssueComment -OwnerName merill -RepositoryName aka -Issue $issueNumber -Body $message | Out-Null
        Update-GitHubIssue -Issue $issueNumber -State Closed -Label "Invalid aka.ms link" -OwnerName merill -RepositoryName aka | Out-Null
    }
    else {

        $autoCrawledTitle = Get-AkaTitle $link

        ## Default to new object and update if it exists
        $akaLink = Get-AkaCustomObject $newItem

        $exists = Test-Path (Join-Path $configPath "$($link).json")
        $state = "Added"
        if($exists) {
            $akaLink = Get-Content (Join-Path $configPath "$($link).json") | Out-String | ConvertFrom-Json
            $state = "Updated"
        }
        $akaLink.link = $link
        $akaLink.autoCrawledTitle = $autoCrawledTitle
        $akaLink.category = $category
        $akaLink.url = $longUrl

        Write-AkaObjectToJsonFile $akaLink

        $message = "Thank you for submitting [aka.ms/$link](https://aka.ms/$link). Your link will soon be available [akaSearch.net](https://akasearch.net). 🙏✅"
        Write-Host $message
        New-GitHubIssueComment -OwnerName merill -RepositoryName aka -Issue $issueNumber -Body $message | Out-Null
        Update-GitHubIssue -Issue $issueNumber -State Closed -Label $state -OwnerName merill -RepositoryName aka | Out-Null

        Update-AkaGitPush
    }
}

function Update-AkaGitPush(){
    git config --global user.name 'merill'
    git config --global user.email 'merill@users.noreply.github.com'
    git add --all
    git commit -am "Automated push from new issue request"
    git push
}