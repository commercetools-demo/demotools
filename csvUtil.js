const fs = require('fs');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const parse = require('csv-parse/lib/sync');

let verbose=false;

// Read CSV file into array of objects, where key is column header
function readCsv(filename) {
  const input = fs.readFileSync(filename,'utf-8');
  const records = parse(input, {
    columns: true,
    skip_empty_lines: true
  }) 
  if(verbose)
    console.log(JSON.stringify(records,null,2));
  return records;
}


// Expects config.outputCSV in config file
function writeCsv(config,rows) {
  if (!fs.existsSync(config.outputCSV.dir)){
      fs.mkdirSync(config.outputCSV.dir, { recursive: true });
  }
  var filename = config.outputCSV.dir + '/' + config.outputCSV.file
  var header = [];
  config.outputCSV.fields.forEach(f => {header.push({id: f, title: f})});
  const csvWriter = createCsvWriter({
      path: filename,
      header: header
  });

  if(config.outputCSV.max) {
    rows = rows.slice(0,config.outputCSV.max);
  }
  csvWriter.writeRecords(rows);
  console.log('Wrote',rows.length,'rows to ',filename);
}

module.exports = {
  readCsv,
  writeCsv
}