// Generic transformation utilities for transforming data fields into commercetools format
'use strict';

const fs = require('fs');
const _ = require('lodash');

let verbose = true;

function mapFields(mapperList,input,output) {
  for(let mapper of mapperList) {
    let value;
    if(Array.isArray(mapper.src)) {
      value = getConcatValue(input,mapper.src,mapper.concat);
    } else {
      value = getValue(input,mapper.src);
    }
    let type = typeof(value);
    if(type == 'number' || !_.isEmpty(value)) {
    
      switch(mapper.convert) {
        case 'price':
          value=[{
            value: {
              currencyCode: 'USD',
              centAmount: parseInt(parseFloat(value)*100)
            }
          }];
          if(verbose)
            console.log('price-type',value);
          break;
        case 'price2':
            value=[{
              value: {
                currencyCode: 'USD',
                centAmount: parseInt(value.substr(4))
              }
            }];
            if(verbose)
              console.log('price-type',value);
            break;
        case 'number':
          value=parseFloat(value);
          break;

        case 'boolean':
          value = (value.toLowerCase==='true');
          break;  
        case 'images':
          let images = [];
          if(!Array.isArray(value))
            value = [ value ];

          for(let v of value) {   
            let url = v;
            if('element' in m)   
              url = getValue(v,mapper.element);    
            let image = {
              url: url,
              dimensions: {
                w: 0,
                h: 0
              }
            }
            images.push(image);
          }
          value = images;
          break;
        case 'list':
          if(!Array.isArray(value))
            value = [ value ];
          let values=[];
          for(let v of value) {
            values.push(getValue(v,mapper.element));
          }
          value = values.join(',');
        default:
          // Do nothing - value is already set
          break;
      }

      // If we have a locale, use that instead.
      // TODO: support multiple locales
      if('locale' in mapper) {
        let localeValue = {};
        localeValue[mapper.locale] = value;
        value = localeValue;
      }

      if(Array.isArray(mapper.dest)) {
        mapper.dest.forEach(d => {output[d]=value});
      } else {
        if(mapper.type=='attr') {
          if(!('attributes' in output)) {
            output.attributes = [];
          }
          // If a price type appears inside an attribute, then take first array entry
          // dereference 
          if(mapper.convert=='price') {
            value = value[0].value;
          }
          output.attributes.push({
            name: mapper.dest,
            value: value
          });
        } else if (mapper.type=='array') {
          output[mapper.dest] = [ value ];
        } else {
          output[mapper.dest] = value;
        }

        if(verbose) {
          console.log(mapper.src,'==>',mapper.dest,value);
        }
      }
    }
  }
}

// Concatenate a list of values into a single string, using concat as
// the concatenation character
function getConcatValue(input,srcList,concat) {
  let values = [];
  for(let src of srcList) {
    let value = getValue(input,src);
    if(value && !_.isEmpty(value))
      values.push(value);
  }
  return values.join(concat);
}

// Fetch a value from the input object, using the mapping specification and the 'src' field name
// If src contains dots, it's a path.
function getValue(input,src) {
  let value;
  if(src.includes('.')) {
    let srcPath = src.split('.');
    srcPath.forEach((s,i) => {
      if(i==0)
        value = input[s];
      else
        value = value[s];
    });
  } else {
    value = input[src];
  }
  return value;
}

function writeJSON(dir,filename,data) {
  if (!fs.existsSync(dir))
    fs.mkdirSync(dir, { recursive: true });
  let j = JSON.stringify(data,null,2);
  filename=dir+'/'+filename;
  console.log('writing',filename);
  fs.writeFileSync(filename,j, 'utf8');
}

function readJSON(filename) {
  console.log('reading',filename);
  let data = fs.readFileSync(filename,'utf8');
  console.log('file size',data.length);
  return JSON.parse(data);
}

// Write an object out as JSON for easier inspection
function inspect(config,filename,data) {
  if(config.inspect) {
    if(config.inspect.enabled) {
      let dir = config.inspect.dir;
      writeJSON(config.inspect.dir,filename,data);
    } else {
      if(verbose)
        console.log('inspect disabled');
    }
  } else {
    console.warn("No inspection information found in configuration file");
  }  
}


module.exports = {
  mapFields,
  inspect,
  writeJSON,
  readJSON
}
