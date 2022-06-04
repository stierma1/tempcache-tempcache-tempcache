let TempcacheService = require("./tempcache-service");
let path = require("path");
let bus = require("bus-bus-bus");


new TempcacheService();

bus.requestResponse("TempcacheService:putObjectByFile", {srcPath:path.join(__dirname, "tempcache-service.js"), key:"tempcache-service.js"})
  .then((val) => {
    return bus.requestResponse("TempcacheService:getFile", {key: "tempcache-service.js"});
  })
  .then((v) => {
    console.log(v);
  })