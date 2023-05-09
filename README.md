# akaSearch.net

[akaSearch.net](https://akasearch.net) Search aka.ms links!

This repository hosts the source code for [akaSearch.net](https://akasearch.net), a crowd sourced database of aka.ms links.

## Contributing

There are a few different ways to contribute to this project.

### Adding a new aka.ms link

#### By submitting an issue (recommended)

This is the easiest way to add a link and will result in the link being added to the site in minutes. Use the [New aka.ms link](https://github.com/merill/aka/issues/new?assignees=&labels=&template=add-link.yaml&title=New+aka.ms+link+) issue template to submit a new link.

#### By submitting a pull request (advanced)

This option is best to make updates to existing links, delete links and bulk add links.

Each link is stored as a .json file at [/website/config](https://github.com/merill/aka/tree/main/website/config). 

Some conventions to follow when creating a pull request using this method.

* The file name is short url of the aka.ms link.
  * e.g. aka.ms/intune → intune.json.
* The file name should be lower case.
* Links with / in the url should be replace with :
  * e.g. aka.ms/ad/ca → ad:ca.json
* Contents in the file
  * **link** - The short name part of the aka.ms link.
  * **title** - The title of the page. Use this field if the link is for a non-public page or if the default title on the target page is not meaningful.
  * **keywords** - A list of comma separated keywords that can be used to include this link when a user searches for it. Useful to include old product names when products are renamed.
  * **category** - The name of the category this link belongs to. This is used to group products together on the site.
    * New categories can be added (check the dropdown on the site for the list of existing categories). Avoid adding alternate names for existing categories.
    * When adding a new category, update the [Add aka.ms issue template](https://github.com/merill/aka/blob/main/.github/ISSUE_TEMPLATE/add-link.yaml) to include the new category.
    * If you wish to go the extra mile you can also add an icon for the category at [/static/img/](https://github.com/merill/aka/tree/main/website/static/img). This is optional, a default icon will be used if a custom one is not provided.
  * **autoCrawledTitle^** - The title of the page. Use this field if the link is for a non-public page or if the default title on the target page is not meaningful.
  * **url^** - The final destination url.

  ^ A daily job will crawl the aka.ms links in this list and update the autoCrawledTitle and url fields to reflect any changes made to the source aka.ms link.

### Reporting Issues

Open a new bug to report issues.
