const rimraf = require("rimraf");
const path = require("path");
const os = require("os");
const fs = require("fs");
const mkdirp = require("mkdirp");
const bus = require("bus-bus-bus");
const cpFile = require('cp-file');

class TempcacheService{
  constructor(tempDir){
    this.tempDir = tempDir || path.join(os.tmpdir(), "tempcache");
    console.log(this.tempDir);
    rimraf.sync(this.tempDir);
    mkdirp.sync(this.tempDir);
    this.cacheKeys = {};
    this.cleanupTimeInterval = 30000;
    this.bumpStrength = 120000;
    this.outstandingRequests = 0;
    this.mailbox = [];
    this.maxOutstanding = 1;
    
    this.telemetryInterval = setInterval(() => {
      bus.emit("telemetry", {emitter:"tempcache-tempcache-tempcache", name:"tempcache.telemetry", outstandingRequests:this.outstandingRequests, mailboxSize:this.mailbox.length});
    }, 5000);
    
    this.cleanupInterval = setInterval(() => {
      for(let cacheKey in this.cacheKeys){
        this.cacheKeys[cacheKey] -= this.cleanupTimeInterval;
        if(this.cacheKeys[cacheKey] <= 0){
          rimraf.sync(path.join(this.tempDir, cacheKey));
          delete this.cacheKeys[cacheKey];
        }
      }
    }, this.cleanupTimeInterval);
    
    bus.on("globalShutdown", () => {
      clearInterval(this.telemetryInterval);
      clearInterval(this.cleanupInterval);
    });
    
    bus.on("TempcacheService:getFile", this.callClient("TempcacheService:getFile", async (returnService, {key}) => {
      if(this.cacheKeys[key] !== undefined){
        this.cacheKeys[key] += this.bumpStrength;
      }
      let readPromise = new Promise((res, rej) => {
        fs.readFile(path.join(this.tempDir, key), (err, data) => {
          if(err){
            rej(err);
            return;
          }
          res(data);
        });
      });
      
      try{
        let data = await readPromise;
        bus.emit(returnService, null, data);
      } catch(err){
        bus.emit(returnService, err);
      }
    }));
    
    bus.on("TempcacheService:getFilePath", this.callClient("TempcacheService:getFilePath", async (returnService, {key}) => {
      if(this.cacheKeys[key] !== undefined){
        this.cacheKeys[key] += this.bumpStrength;
        bus.emit(returnService, null, path.join(this.tempDir, key));
      } else {
        bus.emit(returnService, new Error("Key not found: " + key));
      }
    }));
    
    bus.on("TempcacheService:getStream", this.callClient("TempcacheService:getStream", async (returnService, {key}) => {
      if(this.cacheKeys[key] !== undefined){
        this.cacheKeys[key] += this.bumpStrength;
      }
      
      try{
        let stream = fs.createReadStream(path.join(this.tempDir, key));
        bus.emit(returnService, null, stream);
      } catch(err){
        bus.emit(returnService, err);
      }
    }));
    
    bus.on("TempcacheService:bumpObject", this.callClient("TempcacheService:bumpObject", async (returnService, {key}) => {    
      if(this.cacheKeys[key] !== undefined){
        this.cacheKeys[key] += this.bumpStrength;
        bus.emit(returnService, null, null);
      } else {
        bus.emit(returnService, new Error("Key not found: " + key));
      }
    }));
    
    bus.on("TempcacheService:putObjectByFile", this.callClient("TempcacheService:putObjectByFile", async (returnService, {key, srcPath, initialLife = 120000}) => {
      try{
        this.cacheKeys[key] = initialLife; 
        await cpFile(srcPath, path.join(this.tempDir, key));
        bus.emit(returnService, null, "OK");
      } catch(err){
        bus.emit(returnService, err);
      }
    }));
    
    bus.on("TempcacheService:putObjectByStream", this.callClient("TempcacheService:putObjectByStream", async (returnService, {key, srcStream, initialLife = 120000}) => {
      try{
        this.cacheKeys[key] = initialLife; 
        srcStream.pipe(fs.createWriteStream(path.join(this.tmpDir, key)));
        bus.emit(returnService, null, "OK");
      } catch(err){
        bus.emit(returnService, err);
      }
    }));
  }
  
  async invoke(){
    if(this.mailbox.length > 0 && this.maxOutstanding > this.outstandingRequests){
      let {event, returnService, params, invokeFunc} = this.mailbox.shift();
      bus.emit("log", {emitter:"tempcache-tempcache-tempcache", message:"Request started", event, params, returnService});
      let timer = Date.now();
      try{
        await invokeFunc();
        bus.emit("telemetry", {emitter:"tempcache-tempcache-tempcache", time:Date.now() - timer, event, params, status:"success", returnService, name:"tempcache.request.time"})
      } catch(e){
        bus.emit("telemetry", {emitter:"tempcache-tempcache-tempcache", time:Date.now() - timer, event, params, status:"error", returnService, name:"tempcache.request.time", error:e})
      }
    }
  }
  
  callClient(event, func){
    return (returnService, params) => {
      this.mailbox.push({event, returnService, params, invokeFunc: async () => {
        this.outstandingRequests++;
        try{
          await func(returnService, params);
        } catch(err){
          throw err;
        } finally{
          this.outstandingRequests--;
          setTimeout(() => {this.invoke();}, 0);
        }
      }});
      setTimeout(() => {this.invoke();}, 0);
    }
  }
}

module.exports = TempcacheService;