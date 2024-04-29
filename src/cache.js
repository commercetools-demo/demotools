import fs from 'fs';
/*
Read/write data from cache.  
Param is a 'cache' object of form 
{
  dir: <directory>
  filename: <filename>
  verbose: true or false (optional)
}
TODO: add timeouts & format options (JSON, etc.)
*/
function readFromCache(cache) {
  let fullPath = cache.dir + '/' + cache.filename;
  if(cache.verbose)
    console.log('looking in cache:',fullPath)
  if(fs.existsSync(fullPath)) {
    console.log(`Fetching ${fullPath} from cache`);
    let data = fs.readFileSync(fullPath,"utf8");
    console.log('Found')
    return JSON.parse(data);
  }
  if(cache.verbose)
    console.log('not found');
  return undefined;
}

function writeToCache(cache,data) {
  if(!fs.existsSync(cache.dir)) {
    fs.mkdirSync(cache.dir, {recursive: true} );
  }
  let fullPath = cache.dir + '/' + cache.filename;
  if(cache.verbose)
    console.log('Writing to cache:',fullPath);
  fs.writeFileSync(cache.dir + '/' + cache.filename, JSON.stringify(data,null,2));
}



export {
  readFromCache,
  writeToCache
}