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
    let DEBUG = initDebug | mapper.debug;
    let value = null;
    let src=mapper.src ? mapper.src : mapper.name;
    let dest=mapper.dest ? mapper.dest : mapper.name;
    DEBUG && console.log('mapping',src,'to',dest);
    
    if(Array.isArray(src)) {
      value = getConcatValue(input,src,mapper.concat);
    } else {
      value = getValue(input,src);
      DEBUG && console.log('initial value',value);    
    }
    
    let type = typeof(value);
    DEBUG && console.log('type',type,' is empty?',_.isEmpty(value));
    /* First, we convert the data from the input type to the output type, if any */
    if(type == 'number' || !_.isEmpty(value)) {
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
          DEBUG && console.log('price-type',value);
          break;
        case 'number':
          value=parseFloat(value);
          break;
        case 'boolean':
          switch(type) {
            case 'number':
              value = value != 0;
              break;
            case 'boolean':
              break;
            default:
              let valueStr=value.toString().toLowerCase();
              value = (valueStr=='true' 
                    || valueStr == '1' 
                    || valueStr=='y' 
                    || valueStr=='yes');
              break;
          }
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
          break;
        case 'text':
          // No matter what the input is, convert to a string
          value = value.toString();
          break;
        default:
          // Do nothing - value is already set
      }

      DEBUG &&  console.log('transformed',value);

      // If there are multiple destinations for this value, assign to all
      // example:
      // 'dest' : ['foo','bar']
      if(Array.isArray(dest)) {
        dest.forEach(d => {output[d]=value});
      } else {
        // Now, determine where the value goes (to an attribute, an array, etc.)
        if(mapper.type=='attr') {
          if(!('attributes' in output)) {
            output.attributes = [];
          }
          // If a price type appears inside an attribute, then take first array entry
          // dereference 
          if(mapper.convert=='price') {
            value = value[0].value;
          }
          // If a localized attribute, add to existing if found.
          if('locale' in mapper) {
            let attr = output.attributes.find(a => a.name==dest);
            if(!attr) {
              attr = { name: dest, value: {}};
              attr.value[mapper.locale] = value;
              output.attributes.push(attr);
            } else {
              attr.value[mapper.locale] = value;
            }
          } else {
            // plain (non-localized) attr.
            output.attributes.push({
              name: dest,
              value: value
            });
          }
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
        DEBUG && console.log(src,'==>',dest,value);
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
