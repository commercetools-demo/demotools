# demotools

Tools for building demos.  Primary focus is on transforming / importing data into the 
commercetools platform for standing up demos quickly

## Components

### csvUtil.js

Read / write CSV files (commercetools format)

### transform.js

Data mapping / transformation utils.

### commercetools.js

The "standard" commercetools functions - requestBuilder, client, etc.  
Assumes that CTP environment variables will be in an "env" folder adjacent to the calling script.

# Usage

All functions are exported via demotools.js, so:

```
const dt = require ('@cboyke/demotools')
```
