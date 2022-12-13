// File-handling utilities:  read/write CSV & JSON files
//
const fs = require('fs');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const csv = require('csv-parse/sync');

// Read CSV file into array of objects, where key is column header
function readCsv(filename,delimiter=',',verbose=false) {
  console.log('reading',filename,'delimiter:',delimiter);
  const input = fs.readFileSync(filename,'utf-8');
  const records = csv.parse(input, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    delimiter: delimiter
  }) 
  if(verbose)
    console.log(JSON.stringify(records,null,2));
  console.log('read',records.length,'rows');
  return records;
}

// Write a CSV file to the specified directory
function writeCsv(dir,file,header,rows) {
  if (!fs.existsSync(dir)){
      fs.mkdirSync(dir, { recursive: true });
  }
  var filename = dir + '/' + file  ;
  const csvWriter = createCsvWriter({
      path: filename,
      header: header
  });

  csvWriter.writeRecords(rows);
  console.log('Wrote',rows.length,'rows to ',filename);
}

function readJSON(filename) {
  if(!filename) {
    console.error('No filename passed to readJSON -- exiting');
    process.exit(1);
  }
  console.log('reading',filename);
  let data = fs.readFileSync(filename,'utf8');
  console.log('file size',data.length);
  return JSON.parse(data);
}

function writeJSON(dir,filename,data,indent=1) {
  if (!fs.existsSync(dir))
    fs.mkdirSync(dir, { recursive: true });
  let j = JSON.stringify(data,null,indent);
  filename=dir+'/'+filename;
  console.log('writing',filename);
  fs.writeFileSync(filename,j, 'utf8');
}

// Write an object out as JSON for easier inspection
function inspect(config,filename,data) {
  if(config.inspect) {
    if(config.inspect.enabled) {
      if(filename) {
        writeJSON(config.inspect.dir,filename,data);
      } else {
        console.error('Inspect filename undefined');
      }
    } else {
      console.log('inspect disabled');
    }
  } else {
    console.warn("No inspection information found in configuration file");
  }  
}

module.exports = {
  readCsv,
  writeCsv,
  readJSON,
  writeJSON,
  inspect  
}