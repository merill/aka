/**
 * @name build.js
 * @description Creates Cloudflare _redirect file based on ./config/commands.csv
 */

const fs = require('fs');
const { parse } = require('csv-parse');
const os = require('os');

function getCommand(command, url){
    let cmd = {
        command: command,
        url: url
    }
    return cmd;
}

function expandAlias(commands){
    let allCommands = [];
    commands.forEach(cmd => {
        allCommands.push(getCommand(cmd.command, cmd.url));
        cmd.alias.split(',').forEach(alias => {
            if(alias.length > 0) {
                allCommands.push(getCommand(alias, cmd.url));
            }
        });
    });
    return allCommands;
}

function validateCommands(commands){
    console.log('Validating commands file for redirects');
    let uniqueList = [];
    let duplicates = [];
    commands.forEach(cmd => {
        command = cmd.command;
        if(command.indexOf(' ') >= 0){
            throw new Error('Whitespace found in commands/alias: ' + command);
        }
        lowerCaseCommand = command.toLowerCase();
        if(lowerCaseCommand != command){
            throw new Error('Uppercase characters found in commands/alias: ' + command);
        }
        if(uniqueList.includes(command)){
            duplicates.push(command);
        }
        else{
            uniqueList.push(command);
        }
    });

    if(duplicates.length > 0){
        throw new Error('Duplicate commands/alias were found: ' + duplicates.toString());
    }
}

function createJsonFile(commands){
    const cmds = JSON.stringify(commands);

    let jsonContent = 'export const commands = ' + cmds;
    console.log('Creating commands.table.js');
    fs.writeFileSync('./src/tableHome/commands.table.js', jsonContent);
    console.log('Commands file created successfully.')
}

function createJsonFileForExtension(commands){
    commands.forEach(element => {
        if(element.alias.length != 0){
            element.alias.split(',').forEach(aliasItem => {
                let cmd = {
                    command: aliasItem,
                    alias: aliasItem,
                    description: element.description,
                    keywords: '',
                    category: element.category,
                    url: getTruncatedUrl(element.url)
                }
                commands.push(cmd);
            })
            element.alias = '';
        }
        element.url = getTruncatedUrl(element.url);
    });
    const cmds = JSON.stringify(commands);
    fs.writeFileSync('./static/commands.json', cmds);
}

function getTruncatedUrl(url){
    var shortUrl = url.slice(0, 75);
    if(url.length > 75){
        shortUrl += '...'
    }
    return shortUrl;
}

async function run() {

    console.log('Reading aka .json files');

    const jsonsInDir = fs.readdirSync('./config').filter(file => path.extname(file) === '.json');
    let akaLinks = [];

    jsonsInDir.forEach(file => {
        const fileData = fs.readFileSync(path.join('./config', file));
        const json = JSON.parse(fileData.toString());
        akaLinks.push(json);
    });

        //allCommands = expandAlias(commands);
        //validateCommands(allCommands);
        createJsonFile(commands);
        //createJsonFileForExtension(commands);
}

run();
