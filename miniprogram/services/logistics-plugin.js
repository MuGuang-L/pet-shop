const config=require('./logistics-plugin.json');
function available(){return config.enabled;}
async function open(waybillToken){
 if(!config.enabled||typeof requirePlugin!=='function')throw Error('PLUGIN_UNAVAILABLE');
 const plugin=requirePlugin('logisticsPlugin');
 if(!waybillToken||typeof plugin.openWaybillTracking!=='function')throw Error('PLUGIN_UNAVAILABLE');
 return plugin.openWaybillTracking({waybillToken});
}
module.exports={available,open};
