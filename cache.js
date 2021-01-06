const fs = require('fs');
/*
Read/write data from cache.  
Param is a 'cache' object of form 
{
  dir: <directory>
  filename: <filename>
}
TODO: add timeouts & format options (JSON, etc.)
*/
let verbose=true;

function readFromCache(cache) {
  let fullPath = cache.dir + '/' + cache.filename;
  if(verbose)
    console.log('looking in cache:',fullPath)
  if(fs.existsSync(fullPath)) {
    console.log(`Fetching ${fullPath} from cache`);
    let data = fs.readFileSync(fullPath,"utf8");
    console.log('Found')
    return JSON.parse(data);
  }
  if(verbose)
    console.log('not found');
  return undefined;
}

function writeToCache(cache,data) {
  if(!fs.existsSync(cache.dir)) {
    fs.mkdirSync(cache.dir, {recursive: true} );
  }
  let fullPath = cache.dir + '/' + cache.filename;
  if(verbose)
    console.log('Writing to cache:',fullPath);
  fs.writeFileSync(cache.dir + '/' + cache.filename, JSON.stringify(data,null,2));
}



module.exports = {
  readFromCache,
  writeToCache
}