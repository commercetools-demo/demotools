// Generic transformation utilities for transforming data fields into commercetools format
'use strict';

const _ = require('lodash');
const slugify = require('slugify');

// The standard slugify doesn't (quite) meet commercetools requirements, so we roll our own...
function toSlug(s) {
  return slugify(s.replace(/[^a-zA-Z0-9_\\-]/g,' '));
}

/* Map fields from a source object to a destination object */
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
          value={
            key: value,
            typeId: 'category'
          };
          break;
        case 'price':
          // Force this thing into an array, unless it's an attribute.
          // TO-DO:  handle scoped prices
          if(mapper.type != 'attr')
            mapper.type='array'
          value = parseFloat(value);
          if(isNaN(value)) {
            value = 0;
          }
          value={
            value: {
              currencyCode: 'USD',
              centAmount: parseInt(value*100)
            }
          };
          if(debug)
            console.debug('price-type',value);
          break;
        case 'number':
          value=parseFloat(value);
          break;
        case 'boolean':
          value = (value.toLowerCase==='true' || value=='1');
          break;  
        case 'image':
          // It's an image, but only save it if it's a complete URL
          if(value.startsWith('http://') || value.startsWith('https://')) {          
            value = {
              url: value,
              dimensions: {
                w: 0,
                h: 0
              }
            }
          } else {
            value = null;
          }
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

      // If there are multiple destinations for this value, assign to all
      // example:
      // 'dest' : ['foo','bar']
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
        // If the destination type is an array, then push value to the array
        } else if (mapper.type=='array') {
          if(!(dest in output)) {
            output[dest]=[];
          }
          // Don't push null onto an array!
          if(value != null)
            output[dest].push(value);
        } else {
          if(value == null && mapper.convert == 'number') {
            // Don't set a value for numbers that have no value, as that's not the same as zero!
          } else {
            // Create a holder for (possibly multiple) localized strings
            if('locale' in mapper) {
              if(!(dest in output)) {
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


module.exports = {
  mapFields,
  toSlug,
}
