// Generic transformation utilities for transforming data fields into commercetools format
'use strict';

const fs = require('fs');
const _ = require('lodash');
const slugify = require('slugify');

// The standard slugify doesn't (quite) meet commercetools requirements, so we roll our own...
function toSlug(s) {
  return slugify(s.replace(/[^a-zA-Z0-9_\\-]/g,' '));
}

function mapFields(mapperList,input,output,initDebug=false) {
  for(let mapper of mapperList) {
    let debug = initDebug | mapper.debug;
    let value = null;
    let src=mapper.src ? mapper.src : mapper.name;
    let dest=mapper.dest ? mapper.dest : mapper.name;
    if(Array.isArray(src)) {
      value = getConcatValue(input,src,mapper.concat);
    } else {
      value = getValue(input,src);
    }
    let type = typeof(value);
    if(type == 'number' || !_.isEmpty(value)) {
      if(debug)
        console.log('input value',value);
      let values=[];
      switch(mapper.convert) {
        case 'slug':
          value = toSlug(value);
          break;
        case 'category':
          value=[{
            key: value,
            typeId: 'category'
          }];
          break;
        case 'price':
          value = parseFloat(value);
          if(isNaN(value)) {
            value = 0;
          }
          value=[{
            value: {
              currencyCode: 'USD',
              centAmount: parseInt(value*100)
            }
          }];
          if(debug)
            console.debug('price-type',value);
          break;
        case 'price2':
            // At some point we came across a price with leading non-numerics, so...
            value=[{
              value: {
                currencyCode: 'USD',
                centAmount: parseInt(value.substr(4))
              }
            }];
            if(debug)
              console.debug('price-type',value);
            break;
        case 'number':
          value=parseFloat(value);
          break;

        case 'boolean':
          value = (value.toLowerCase==='true' || value=='1');
          break;  
        case 'images':
          let images = [];
          if(!Array.isArray(value))
            value = [ value ];

          for(let v of value) {   
            let url = v;
            if('element' in mapper)   
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
          for(let v of value) {
            values.push(getValue(v,mapper.element));
          }
          value = values.join(',');
          break;
        case 'newline-list':
          value = value.split('\n');
          for(let v of value) {
            v = v.trim();
            if(v)
              values.push(v);
          }
          value = values;
        default:
          // Do nothing - value is already set
          break;
      }

      if(Array.isArray(dest)) {
        dest.forEach(d => {output[d]=value});
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
            name: dest,
            value: value
          });
        } else if (mapper.type=='array') {
          output[dest] = [ value ];
        } else {
          if(value == null && mapper.convert == 'number') {
            // Don't set a value for numbers that have no value, as that's not the same as zero!
          } else {
            if('locale' in mapper) {
              if(!output[dest]) {
                output[dest]={}
              }
              output[dest][mapper.locale] = value;              
            } else {
              output[dest] = value;
            }
          }
        }

        if(debug) {
          console.debug(src,'==>',dest,value);
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

function writeJSON(dir,filename,data,indent=1) {
  if (!fs.existsSync(dir))
    fs.mkdirSync(dir, { recursive: true });
  let j = JSON.stringify(data,null,indent);
  filename=dir+'/'+filename;
  console.log('writing',filename);
  fs.writeFileSync(filename,j, 'utf8');
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
  mapFields,
  inspect,
  writeJSON,
  readJSON,
  toSlug,
}
