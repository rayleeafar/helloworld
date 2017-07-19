var fs = require('fs');
var mqtt = require("mqtt");
var jsonfile = require('jsonfile');
var loraURL = "mqtt://127.0.0.1";
var lagoonURL = "mqtt://101.200.34.179";
var logto = require('winston');
var LOG_FILE = 'log/siphonage.log';
var CONFIG_FILE='conf/siphonage.js';
var GWID="GW_XJCJ67";
//init all and save last runtime log
var config;
try {
    config=require(CONFIG_FILE);
    GWID=config.GWID;
    //save last runtime log data
    if(fs.existsSync("log/siphonage.log"))
        fs.createReadStream(LOG_FILE).pipe(fs.createWriteStream('log/log'+Date.parse(new Date())+'.log'));
    else
        console.log("There's no log file !");
} catch (error) {
    console.log("error config file or wrong with copy log file !");
}

//logto.handleExceptions(
//    logto.transports.File,{ filename: '/var/log/siphonageException.log' }
//);

logto.add(
  logto.transports.File, { filename:LOG_FILE }
);

logto.info('siphonage Starting');

/* update the status.json in order for multitech conduit app-manager to recogonize
the status of the app*/
var status={
    "pid": process.pid,
    "AppInfo": "Started."
}

/*jsonfile.writeFile(process.env.PWD+"/status.json",status, function (err){
    console.error(err)
});*/
//******************************************************************************
thingList={}; // store the registered things and their last update timestamp
thingInterval={};//store the registered thing's updating interval
stedTimeList={};//save every sted's timestamp,to know the sensor data's time
stedlist={};//save sted's sensor data
wslist={};//handle mutil WeatherStation data casue WS1,WS2
TCBat={};
var maxInterval=0;//store max Interval to confirm weather mdot is online
//stedTimeList["current"]=0;
//stedTimeList["devID"]=0;
//******************************************************************************

// subscribe to local mqtt server
var mDotProxy  = mqtt.connect(loraURL);
var lagoon = mqtt.connect(lagoonURL, {username: 'pastoral', password: 'pastoralkicksass'});

//mqtt to aliyun test block
lagoon.on('connect', function(){
	var gatewayinfo={};
	gatewayinfo["GW_ID"]=GWID;
	gatewayinfo["online"]="true";
    lagoon.publish('gateway/update',JSON.stringify(gatewayinfo));
    lagoon.subscribe('things/+/interval_request');
    lagoon.subscribe('gateway/'+GWID+'/request/+');
    lagoon.subscribe('gateway/GW_ALL/request/+');
    logto.info('login lagoon ,subscribe chnal down:'+Date.now());
    
})

//*****************local functional functions***********************************
function loraParse(rawData,eui) {
        // this function parses the raw data uploaded by mdot
        if(rawData.indexOf(',')<0){
            console.log("Imcomplete split data!");
            return 1;
        }
        var msg=rawData.split(',');
        var devID=msg[0];
        //add timestamp
        var timestamp=Date.parse(new Date())/1000+'';
        var reportedState = {};
        reportedState['timestamp']=timestamp;
        //check if this is a new sensor device 
        //get a unique id and send to the device
        if(msg.length===2){
            var devhardID=msg[0];
            var devType=msg[1];
            //var devID=getdevID();
        }


        if (!thingList.hasOwnProperty(devID)){
                // if the device has not been registered before, register it
                // and also reset the polling interval to 15 seconds
                //var replyData=Buffer("I1800").toString('base64');
                //sendToNode(eui, replyData);
                thingInterval[devID]='01800';
                if(devID.indexOf('ST') > -1) {
                    stedTimeList[devID]={};
                    stedlist[devID] = {
                                20:'null',
                                40:'null',
                                60:'null',
                                80:'null',
                                100:'null',
                                120:'null',
                                140:'null',
                                160:'null',
                                timestamp:'0'
                    };
                    stedTimeList[devID]["current"]=1;
                }
                else if(devID.indexOf('WS') > -1){
                    wslist[devID]={};
                }
                 else if(devID.indexOf('TC') > -1){
                    TCBat[devID]={};
                    TCBat[devID]["num"]=0;
                    TCBat[devID]["a0"]=0;
                    TCBat[devID]["a1"]=0;
                    TCBat[devID]["a2"]=0;
                    TCBat[devID]["boot"]=1;
                }
                
                //reportedState = {};
                //reportedState["interval"]="15";
                //lagoon.publish('things/'+devID+'/interval_confirm', JSON.stringify(reportedState));
                //thingList[devID]=timestamp;
        }
       
        
        // check to see if the device has been registered before
        if (thingInterval[devID].charAt(0)!=0) {
                // if reported interval has been updated, send the new interval back to mDot
                // header for replying interval back to mDot is 'I'
                //var inter='I';
                //inter += thingInterval[devID];
                var replyData=Buffer(thingInterval[devID]).toString('base64');
                sendToNode(eui, replyData);
        }

        //update devicei's latest up date timestamp 
        //cause things/request/device need it!!
        thingList[devID]=timestamp; 

        if (msg.length==3) {
            // if the message from mDot is a new interval, clear the update interval
            // flag
            if (msg[1]==="interval"){
                thingInterval[devID]="0"+ msg[2];
                reportedState["interval"] = msg[2];
                try {
                    var interval=parseInt(msg[2]);
                    if(maxInterval<interval){
                        maxInterval=interval;
                    }
                } catch (error) {
                    console.log("Imcomplete interval confirm data!");
                    return 1;
                }
                
                lagoon.publish('things/'+devID+'/interval_confirm', JSON.stringify(reportedState));
                reportedState = {};
                return 0;
            }else if (msg[1]==="battery") {
                reportedState["battery"] = msg[2];
                lagoon.publish('things/'+devID+'/battery_update', JSON.stringify(reportedState));
                reportedState = {};
                return 0;
            }else if (msg[1]==="MainPower") {
                var rawvol=parseFloat(msg[2]);
                var bdata=0;
                if(isNaN(rawvol)){
                    console.log('prase int erro!');
                }else{
                    bdata=rawvol/1000.0;
                    bdata=bdata.toFixed(2);
                    if(TCBat[devID]["num"]<5){
                        TCBat[devID]["a1"]=parseFloat(TCBat[devID]["a1"])+parseFloat(bdata);
                        console.log('a1='+TCBat[devID]["a1"]);
                    }else if(TCBat[devID]["num"]<10 && TCBat[devID]["num"]>5){
                        TCBat[devID]["a1"]=(parseFloat(TCBat[devID]["a1"])/5.0).toFixed(2);
                        TCBat[devID]["a2"]=parseFloat(TCBat[devID]["a2"])+parseFloat(bdata);
                        console.log('a2='+TCBat[devID]["a2"]);
                    }else if(TCBat[devID]["num"]<15 && TCBat[devID]["num"]>10){
                        TCBat[devID]["a2"]=(parseFloat(TCBat[devID]["a2"])/5.0).toFixed(2);
                        TCBat[devID]["a3"]=parseFloat(TCBat[devID]["a3"])+parseFloat(bdata);
                        console.log('a3='+TCBat[devID]["a3"]);
                    }
                    TCBat[devID]["num"]=TCBat[devID]["num"]+1;
                    if(TCBat[devID]["num"]>=15){
                        TCBat[devID]["a3"]=(parseFloat(TCBat[devID]["a3"])/5.0).toFixed(2);
                        TCBat[devID]["num"]=0;
                        bdata=((parseFloat(TCBat[devID]["a1"])+parseFloat(TCBat[devID]["a2"])+parseFloat(TCBat[devID]["a3"]))/3.0).toFixed(2);
                        bdata=mapTCBat(bdata);
                        reportedState["battery"] = bdata;
                        //lagoon.publish('things/'+devID+'/battery_update', JSON.stringify(reportedState));
                        TCBat[devID]["a1"]=0;
                        TCBat[devID]["a2"]=0;
                        TCBat[devID]["a3"]=0; 
                        //TCBat[devID]["boot"]=0;
                    }
                    if(TCBat[devID]["boot"]==1){
                        bdata=mapTCBat(rawvol/1000.0);
                        reportedState["battery"] = bdata;
                        lagoon.publish('things/'+devID+'/battery_update', JSON.stringify(reportedState));
                    }
                        
                }
                return 0;
            }else if (msg[1]==="VOL") {
                var rawvol=parseFloat(msg[2]);
                var bdata=0;
                if(rawvol!=NaN){
                    bdata=(rawvol-3500)/700.0;
                    bdata=bdata.toFixed(2);
                    reportedState["battery"] = bdata;
                    lagoon.publish('things/'+devID+'/battery_update', JSON.stringify(reportedState)); 
                }
                else{
                    console.log('prase int erro!');
                }
                 reportedState = {};
                 return 0;
            } else if (msg[1]==="BT") {      
                reportedState["boot"] = msg[2];
                lagoon.publish('things/'+devID+'/boot', JSON.stringify(reportedState));
                reportedState = {};
                return 0;
            } else if (msg[1]==="YZ") {
                reportedState["last_will"] = msg[2];
                lagoon.publish('things/'+devID+'/last_will', JSON.stringify(reportedState));
                reportedState = {};
                return 0;
            }else if (msg[1]==="gps") {
                if(msg[2].indexOf(';')<0){
                     console.log("Imcomplete split data!");
                     return 1;
                }
                var gpsdata=msg[2].split(';');
                if(gpsdata.length==4){
                    var lat=parseFloat(gpsdata[0]);
                    var lata=Math.floor(lat/100);
                    var latb=(lat-lata*100)/60.0;
                    lat=lata+latb;
                    var lon=parseFloat(gpsdata[2]);
                    var lona=Math.floor(lon/100);
                    var lonb=(lon-lona*100)/60.0;
                    lon=lona+lonb;
                    //var lon=parseFloat(gpsdata[2])
                    reportedState["lat"] = lat.toFixed(4)+"";//(parseFloat(gpsdata[0])/100).toFixed(4);
                    reportedState["lon"] = lon.toFixed(4)+"";//(parseFloat(gpsdata[2])/100).toFixed(4);
                    lagoon.publish('things/'+devID+'/location', JSON.stringify(reportedState));
                }else{
                    console.log("Imcomplete GPS data!");
                    return 1;
                }
                reportedState = {};
                return 0;
            }else if (msg[1]==="STH") {
                if(msg[2].indexOf(';')<0){
                     console.log("Imcomplete split data!");
                     return 1;
                }
                var shtdata=msg[2].split(';');
                try {
                     stedlist[devID]['surface_temperature'] =shtdata[0];
                } catch (error) {
                    console.log("erro wsl data!");
                    return 1;
                }
            }else if (msg[1]==="sted") {
                //can only handle one same devID STED data
                if(msg[2].indexOf('#')<0){
                     console.log("Imcomplete split data!");
                     return 1;
                }
                var steddata=msg[2].split('#');
                if(stedTimeList[devID]["current"]!=1){
                    if(stedTimeList[devID]["current"]!==parseInt(steddata[0])){
                        //console.log("another time's sted msg:"+stedTimeList[devID]["current"]);
                        stedlist[devID]['timestamp']=timestamp;
                        lagoon.publish('things/'+devID+'/reading', JSON.stringify(stedlist[devID]));
                        stedTimeList[devID]["current"]=parseInt(steddata[0]);
                        stedlist[devID] = {
                            20:null,
                            40:null,
                            60:null,
                            80:null,
                            100:null,
                            120:null,
                            140:null,
                            160:null,
                            timestamp:'0'
                        };
                    } 
                }else{
                    stedTimeList[devID]["current"]=parseInt(steddata[0]);
                }
                //console.log("sted msg:"+msg[2]);
                if(steddata[1].indexOf('/')<0){
                     console.log("Imcomplete split data!");
                     return 1;
                }
                var signalpart=steddata[1].split('/');
                if(signalpart.length==4){
                        stedlist[devID][parseInt(signalpart[0])+'']={};
                        try {
                            stedlist[devID][parseInt(signalpart[0])+'']["depth_temperature"]=parseFloat(signalpart[1])+"";
                            stedlist[devID][parseInt(signalpart[0])+'']["soil_moisture"]=parseInt(signalpart[2])+"";
                            stedlist[devID][parseInt(signalpart[0])+'']["soil_conductivity"]=parseInt(signalpart[3])+"";
                        } catch (error) {
                            console.log("Imcomplete STED data!");
                            return 1;
                        }
                }
                return 0;
            }else if (msg[1]==="TC") {
                if(msg[2].indexOf(';')<0 | msg[2].split(';').length!= 4){
                     console.log("Imcomplete split data!");
                     return 1;
                }
                var tcdata=msg[2].split(';');
               
                reportedState["air_temperature"] =tcdata[0];

                 try {
                    var humtmp=parseFloat(tcdata[1]).toFixed(2);
                    if(humtmp>100)
                        tcdata[1]=100;
                    console.log("humi="+tcdata[1]);
                    reportedState["humidity"]=tcdata[1];
                } catch (error) {
                    console.log("humi X!");
                    //return 1;
                }
            
                try {
                    var co2tmp=parseInt(tcdata[2]);
                    if(tcdata[2].charAt(0)<'0' | tcdata[2].charAt(0)>'9')
                    {
                            console.log("CO2 X!");
                            //return 1;
                    }
                    if(co2tmp<0){
                        co2tmp=Math.abs(co2tmp);
                        co2tmp=co2tmp+32896;
                        tcdata[2]=co2tmp;
                    }
                    //console.log("CO2="+tcdata[2]);
                    reportedState["co2"] =tcdata[2];
                } catch (error) {
                    console.log("CO2 X!");
                    
                }

                var tmp=parseFloat(tcdata[3]);
                tmp=tmp.toFixed(2);
                if(tmp > -50 && tmp < 100)
                    reportedState["soil_temperature"] =tcdata[3];

                lagoon.publish('things/'+devID+'/reading', JSON.stringify(reportedState));
                reportedState = {};
                return 0;
            }else if (msg[1]==="WS1") {
                 if(msg[2].indexOf(';')<0){
                     console.log("Imcomplete split data!");
                     return 1;
                }
                var wsdata=msg[2].split(';');
                if(wsdata.length==3){
                    try {
                        var tmp=parseFloat(wsdata[0]).toFixed(2);
                        (tmp==0.00)?tmp=0:tmp;
                        wslist[devID]["air_temperature"] = tmp+'';
                        tmp=parseFloat(wsdata[1]).toFixed(2);
                        (tmp==0.00)?tmp=0:tmp;
                        wslist[devID]["humidity"] = tmp+'';
                        wslist[devID]["lux"] =parseInt(wsdata[2],10)+'';
                        //console.log("Up WS1 data done!");
                    } catch (error) {
                         console.log("Erro WS1 data!");
                         return 1;
                    }  
                }else{
                    console.log("Imcomplete WS1 data!");
                    return 1;
                }
                reportedState = {};
                return 0;
            }else if (msg[1]==="WS2") {
                 if(msg[2].indexOf(';')<0){
                     console.log("Imcomplete split data!");
                     return 1;
                }
                var wsdata=msg[2].split(';');
                if(wsdata.length==4){
                    try {
                        wslist[devID]["wind_speed"] = (parseInt(wsdata[0],10)/10)+'';

                        wslist[devID]["wind_direction"] =parseInt( wsdata[1],10)+'';

                        wslist[devID]["rain_hourly"] = parseInt(wsdata[2],10)+'';
                        //handle fault pressure data with b0900 and add '0'
                        if(wsdata[3].charAt(0)<'0' | wsdata[3].charAt(0)>'9'){
                            wsdata[3]=wsdata[3].replace(wsdata[3].charAt(0),'0');
                            wsdata[3]=wsdata[3]+'0';
                        }
                        var pretemp=parseInt(wsdata[3],10)/10;
                        if(pretemp>10)
                            wslist[devID]["pressure"] = parseInt(wsdata[3],10)/10+'';

                        wslist[devID]['timestamp']=timestamp;

                        if(Object.keys(wslist[devID]).length===8){
                            lagoon.publish('things/'+devID+'/reading', JSON.stringify(wslist[devID]));
                        }else{
                            console.log("Up WS2 data fail!--"+(JSON.stringify(wslist[devID])).toString()+"--"+"length:"+Object.keys(wslist[devID]).length);
                            return 1;
                        }  
                    } catch (error) {
                         console.log("Erro WS2 data!");
                         return 1;
                    }  
                }else{
                    console.log("Imcomplete WS2 data!");
                    return 1;
                }
                reportedState = {};
                return 0;
            }else {
                reportedState["reading"] = {};
                reportedState["reading"][msg[1]]=msg[2];
                lagoon.publish('things/'+devID+'/other', JSON.stringify(reportedState));
                if(devID.indexOf('ST') > -1) {
                    fs.appendFile('/var/log/'+devID+'.txt', msg[2], function (err) {
                        if (err) return 1;
                        console.log('The "data to append" was appended to file!');
                    });
                }
                return 0;
            }
        }else{
            console.log("Wrong Sensor msg, the length must be 3 !-such as- devID,dataType,data !")
        } 
}



//*************************************************************
function sendToNode(eui, payload) {
    // send message to lora accessory card
    var message = {
          "data": payload
    };
    topic = "in/" + eui;
    console.log("topic: ", topic);
    console.log("publishing: ", JSON.stringify(message));
    mDotProxy.publish(topic, JSON.stringify(message));
}
//************************************************************
function sendStedlist(){
    return;
}
//*************************************************************

function mapTCBat(avdata){
    if(avdata>6.7){
        if(avdata>7.2)
            avdata=7.2;
        avdata=(avdata-6.7)*0.04+0.98;
        return avdata.toFixed(2);
    }else if(avdata>5.5){
        avdata=(avdata-5.5)*0.066+0.9;
        return avdata.toFixed(2);
    }else if(avdata>5){
        avdata=(avdata-5)*0.2+0.8;
        return avdata.toFixed(2);
    }else if(avdata>4.5){
        avdata=(avdata-4.5)*1.6;
        return avdata.toFixed(2);
    }else{
        return 0;
    }

}
//*************************************************************

function getlocalip() {
    var http = require('http');
    var options = {
        host: 'whatismyip.akamai.com',
        path: ''
    };
    callback = function(response) {
        var report = {};
        var ipstr = '';
        //another chunk of data has been recieved, so append it to `str`
        response.on('data', function (chunk) {
            ipstr += chunk;
        });
        //the whole response has been recieved, so we just print it out here
        response.on('end', function () {
            console.log(ipstr);
            report["ip_address"]=ipstr;
            lagoon.publish('gateway/'+GWID+'/env', JSON.stringify(report));
        });
         //if got erro get internal ip instead
        response.on('error', function (e) {
            if(e.code==='ECONNRESET'){
                console.log('get externalIP error:ECONNRESET');
            }
            console.log('get externalIP error:'+e);
            logto.info('get externalIP error:'+e);
            var os=require('os');
            ifaces=os.networkInterfaces();
            for (var dev in ifaces) {
                    ifaces[dev].forEach(function(details,alias){
                    if ((details.family=='IPv4') && (details.internal == false)) {
                    report["ip_address"] = details.address;
                    }
                });
            }
            lagoon.publish('gateway/'+GWID+'/env', JSON.stringify(report));
            return;
        });     
    }

    try {
        http.request(options, callback).end();    
    } catch (error) {
        console.log('get conduit IP error:'+error);
        logto.info('get conduit IP error:'+error);
    }
    
}
//************************************************************


mDotProxy.on('connect', function() {
    console.log("Lora accessory card connected, subscribing");
    logto.info('Lora accessory card connected, subscribing');
    // subscribe to all upstream lora packets
    mDotProxy.subscribe('out/+');
    mDotProxy.subscribe('lora/'+GWID+'/isalive');
    //timer to check weather mdot is on line
    setInterval(function(){
					var timenow=Date.parse(new Date())/1000;
                    console.log("set things check mission on!");
                    var lostthinginfo={};
                    lostthinginfo["lost_device"]={};
					for(key in thingList){
                        console.log('ID:['+key+']---Interval:'+thingInterval[key]);
                        var intervalval=thingInterval[key].replace(thingInterval[key].charAt(0),'0');
                        if((timenow-thingList[key])>(10*parseInt(intervalval))){
                            lostthinginfo["lost_device"][key]=((timenow-thingList[key])/60).toFixed(2)+'';
                            console.log('Device ID['+key+'] lost , no msg up in '+((timenow-thingList[key])/60).toFixed(2)+'mins');
                        }
                    }
                    if(Object.keys(lostthinginfo["lost_device"]).length === 0) 
                        console.log("things check mission ok!");
                    else{
                        lostthinginfo["GW_ID"]=GWID;
                        lostthinginfo["timestamp"]=timenow;
                        lagoon.publish('things/lost',JSON.stringify(lostthinginfo));
                    }
				},
	1800000);
});

mDotProxy.on("error", function(error) {
    console.log("mqtt error: ", error);
    logto.info('mqtt error: ' + error);
    exit();	
});

// this function is a listener on lora connection
mDotProxy.on('message', function(topic, message) {
    //logto.info('topic:' + topic);
    //console.log("message: ", message.toString());
    eui = topic.split('/')[1];
    
    // convert MQTT message to JSON object
    // message contains the following fields
    // freq; datr; lsnr; rssi; seqn; timestamp
    json = JSON.parse(message.toString());
    // decode base64 payload
    data = new Buffer(json.data, "hex");
    logto.info('Got data form:'+eui+'with data: '+data.toString());
	//console.log('Got data form:'+eui+'with data: '+data.toString());
    loraParse(data.toString(),eui);

    //var ackmsg='GW got';
    //var replyMsg=Buffer(ackmsg).toString('base64');
    //sendToNode(eui, replyMsg);
    //logto.info('Send ACK data to: '+ eui);
});

lagoon.on('error',function(error) {
    console.log("connect lagoon error: ", error);
    logto.info('connect lagoon error: ' + error);
    exit();
});

lagoon.on('message', function(topic, message){
   
    devID = topic.split('/')[1];
    msgType = topic.split('/')[2];
   
    if(msgType=='request'){
        msgType = topic.split('/')[3];
    }

    if (msgType == 'interval_request'){
         try {
                lagoonJSON = JSON.parse(message.toString());
                logto.info('Received interval message from lagoon'+message.toString()+'#T'+Date.now());
                //if interval header with char 'I' means it a new interval
                thingInterval[devID] = "I"+lagoonJSON.interval;
        } catch (error) {
                console.log('Received erro JSON message from lagoon');
                logto.info('Received erro JSON message from lagoon'+message.toString()+'#T'+Date.now());
                lagoonJSON= {};
                return 1;
        }    
    }
    else if(msgType=='env'){
        getlocalip();
    }
    else if(msgType=='ping'){
        reportedState = {};
        reportedState["online"]='True';
        lagoon.publish('gateway/'+GWID+'/ping', JSON.stringify(reportedState));
        logto.info('Got ping_request from lagoon:'+Date.now());
    }
    else if(msgType=='device'){        
        lagoon.publish('gateway/'+GWID+'/device', JSON.stringify(thingList));
        logto.info('Got device_request from lagoon:'+Date.now());
    }
    else{
        logto.info('Got unknow request info from lagoon:'+Date.now());
        logto.info('topic:'+topic);
        logto.info('msg:'+message.toString());
    }
})