# demotools

Tools to aid in the process of building demos, scripts, etc. for commercetools.  
The Primary focus is on transforming product catalog data and importing into the commercetools platform for standing up demos quickly

# Components

# commercetools.js

Encapsulation of the "standard" apiRoot

Place the commercetools connection parameters in a file named **.env** in a folder adjacent to your calling script.


```getAll``` -- Issue a query that will potentially return large amounts of data

Pass: endpoint, queryArgs
Return: an array of results.



---
# transform.js

Data mapping / transformation utils.
The heart of this module is the *mapFields* function, which takes an array of *mappers* as an argument.  A mapper describes mapping of one source field to one (or more) destination fields.

A Mapper has (up to) four fields:

* src: The name of the field in the source object
* dest: The name of the field in the destination object
* convert: (optional) - a conversion operation to perform.  One of:
    slug, category, price, number, boolean, image, list, newline-list

* type: (optional) - the data type of the destination field.  One of:
  attr, array

Examples:
```js
{
  src: 'ProductID',
  dest: 'key',
}
```
The field *ProductID* in the source object will be mapped to the field *key* in the destination object -- no transformations performed (straight copy)
## Price
Convert a Price:
```js
{
  src: 'SalePrice',
  dest: 'prices',
  convert: 'price'
}
```

## Localized Fields:

```js
{
  src: 'ProductName',
  dest: 'name',
  locale: 'en-US'
}
```
In this case, ProductName in the source will map to a localized field *name* in the destination, in a structure used by commercetools localized fields.

## Attributes
```js
{
  src: 'Department',
  dest: 'department',
  type: 'attr'
}
```
The source field Department will be copied to an attribute called *department* in an *attributes* array of the destination object

## Category (reference by key)
Use both a 'convert' (to convert to a reference to a category), and a 'type' (array)
```js
{
  src: 'CategoryID',
  dest: 'categories',
  convert: 'category',
  type: 'array'
}
```
## Images
Convert to an (external) image format
```js
{
  src: 'MainImageURL',
  dest: 'images',
  convert: 'image',
  type: 'array'
}
```
---
# files.js


## readCSV, writeCSV, readJSON, writeJSON, inspect
TODO: document these

---
# Linking locally

If developing locally, do 'yarn link' in this directory, then 'yarn link @cboyke/demotools' in the dependent folder.

