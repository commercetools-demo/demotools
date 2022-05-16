// Read an excel spreadsheet and return an array of rows, keyed on column headers
// Assuming first row is headers.
const xlsx = require("xlsx");

const verbose = false;

function sheet2rows(config, sheet) {
  var result = [];
  var row;
  var rowNum;
  var colNum;

  var headers = [];
  var r = 0;
  for (var c = 0; c < 100; c++) {
    var addr = xlsx.utils.encode_cell({ r: r, c: c });
    var cell = sheet[addr];
    if (typeof cell === "undefined") {
      break;
    }
    headers.push(cell.w);
  }
  if (verbose) {
    console.log("Headers:", headers);
  }
  for (r = 1; r <= config.input.max; r++) {
    let isEmpty = true;
    row = {};
    for (c = 0; c <= headers.length; c++) {
      var nextCell = sheet[xlsx.utils.encode_cell({ r: r, c: c })];
      if (typeof nextCell != "undefined") {
        row[headers[c]] = nextCell.w;
        isEmpty = false;
      }
    }
    if(isEmpty)
        break;
    else
        result.push(row);
  }
  return result;
}

// Read excel spreadsheet and return an array of rows with each row's keys = spreadsheet headers.
function readExcel(config) {
  var rows = [];
  var wb = xlsx.readFile(config.input.filename);
  var ws = wb.Sheets[config.input.sheet];
  if (ws == null) {
    console.log("Worksheet", config.input.sheet, "not found");
  } else {
    rows = sheet2rows(config, ws);
    if (verbose) {
      console.log(rows);
    }
  }
  return rows;
}

module.exports = {
  readExcel,
};
