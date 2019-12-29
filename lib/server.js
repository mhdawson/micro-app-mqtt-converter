// Copyright 2016 the project authors as listed in the AUTHORS file.
// All rights reserved. Use of this source code is governed by the
// license that can be found in the LICENSE file.
const mqtt = require('mqtt');
const path = require('path');
const socketio = require('socket.io');
const util = require('util');
const fs = require('fs');
const eventLog = require('./eventLog.js');
const readline = require('readline');

// this is filled in later as the socket io connection is established
let eventSocket;

const Server = function() {
}


Server.getDefaults = function() {
  return { 'title': 'Converter' };
}

let replacements;
Server.getTemplateReplacments = function() {

  const pageHeight = Server.config.windowSize.y;
  const pageWidth = Server.config.windowSize.x;

  // create the html for the divs
  const divs = new Array();
  divs[0] = '    <div id="logdata"' + ' style="position: absolute; ' +
                 'width:' + (pageWidth - 2) + 'px; ' +
                 'height:' + (pageHeight - 30) +  'px; '  +
                 'top:' + '0px; ' +
                 'left:' + '1px; ' +
                 'background-color: white; ' +
                 'font-size:11px;' +
                 'overflow:auto;' +
                 '"></div> ';

  if (replacements === undefined) {
    const config = Server.config;

    replacements = [{ 'key': '<DASHBOARD_TITLE>', 'value': config.title },
                    { 'key': '<UNIQUE_WINDOW_ID>', 'value': config.title },
                    { 'key': '<CONTENT>', 'value': divs.join("\n")},
                    { 'key': '<PAGE_WIDTH>', 'value': pageWidth },
                    { 'key': '<PAGE_HEIGHT>', 'value': pageHeight }];

  }
  return replacements;
}

Server.startServer = function(server) {
  const config = Server.config;
  eventSocket = socketio.listen(server);

  // setup mqtt
  let mqttOptions;
  if (config.mqttServerUrl.indexOf('mqtts') > -1) {
    mqttOptions = { key: fs.readFileSync(path.join(__dirname, 'mqttclient', '/client.key')),
                    cert: fs.readFileSync(path.join(__dirname, 'mqttclient', '/client.cert')),
                    ca: fs.readFileSync(path.join(__dirname, 'mqttclient', '/ca.cert')),
                    checkServerIdentity: function() { return undefined }
    }
  }

  const mqttClient = mqtt.connect(config.mqttServerUrl, mqttOptions);

  const sendCommand = function(command) {
    try {
      mqttClient.publish(command.topic, command.message);
      eventLog.logMessage(config, 'Schedule event, topic[' + command.topic + '] message [' + command.message + ']', eventLog.LOG_INFO);
    } catch (e) {
      // we must not be connected to the mqtt server at this
      // point just log an error
      eventLog.logMessage(config, 'failed to publish message', eventLog.LOG_WARN);
    }
  }

  eventSocket.on('connection', function(ioclient) {
    const lineReader = readline.createInterface({
      input: fs.createReadStream(eventLog.getLogFileName(config))
    });
    lineReader.on('line', function(line) {
      eventSocket.to(ioclient.id).emit('eventLog', line);
    });

    const eventLogListener = function(message) {
      eventSocket.to(ioclient.id).emit('eventLog', message);
    }
    eventLog.addListener(eventLogListener);

    eventSocket.on('disconnect', function () {
      eventLog.removeListenter(eventLogListener);
    });
  });

  eventLog.logMessage(config, 'Converter starting', eventLog.LOG_INFO);

  let lookupTasks = undefined;
  mqttClient.on('connect', function() {
    lookupTasks = new Object();

    // listen on the appropriate topics and build the lookup hash
    converterTasks = undefined;
    const converterFile = path.join(__dirname, 'converter.json');
    if (fs.existsSync(converterFile)) {
      converterTasks = JSON.parse(fs.readFileSync(converterFile));
      for (let i = 0; i < converterTasks.length; i++) {
        mqttClient.subscribe(converterTasks[i].topic, (err) => {});
        lookupTasks[converterTasks[i].topic + converterTasks[i].message] = converterTasks[i];
      }
    }
  });

  // run the commands in an entry
  const runEntry = function(converterTask) {
    for( let j = 0; j < converterTask.length; j++) {
      setTimeout(function(command) {
        sendCommand(command);
      }.bind(undefined, converterTask[j]), converterTask[j].delay);
    }
  }

  // run the appropriate commands when an message comes in
  mqttClient.on('message', (topic, message) => {
    const key = topic + message.toString();
    if (lookupTasks[key]) {
      if (lookupTasks[key].message === message.toString()) {
        runEntry(lookupTasks[key].commands);
      }
    }
  });
};


if (require.main === module) {
  let microAppFramework = require('micro-app-framework');
  microAppFramework(path.join(__dirname), Server);
}


module.exports = Server;
