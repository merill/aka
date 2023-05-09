import React from "react";
import { PageMetadata } from "@docusaurus/theme-common";
import Layout from "@theme/Layout";
import Head from '@docusaurus/Head';
import { CommandsTable } from "@site/src/components/CommandsTable";
import { commands } from "@site/src/tableHome/commands.table";
import { columns } from "@site/src/tableHome/columns.table";

export default function Start() {
  return (
    <>
      <PageMetadata
        title='Search aka.ms'
      />
      <Layout>
      <Head>
          <meta property="og:url" content="https://akaSearch.net" />
          <meta property="og:type" content="website" />
          <meta property="og:title" content="Search aka.ms" />
          <meta property="og:description" content="Use this page to search for aka.ms links that have been contributed to by the community." />
          <meta property="og:image" content="https://akasearch.net/OpenGraphImage.png" />
          <meta property="og:image:alt" content="Screenshot of akasearch.net home page with the text 'Crowd sourced database of aka.ms links!'" />

          <meta name="twitter:card" content="summary_large_image" />
          <meta property="twitter:domain" content="akasearch.net" />
          <meta property="twitter:site" content="@merill" />
          <meta property="twitter:url" content="https://akasearch.net" />
          <meta name="twitter:title" content="Search aka.ms" />
          <meta name="twitter:description" content="Use this page to search for aka.ms links that have been contributed to by the community." />
          <meta name="twitter:image" content="https://akasearch.net/OpenGraphImage.png" />
          <meta property="twitter:image:alt" content="Screenshot of akasearch.net home page with the text 'Crowd sourced database of aka.ms links!'" />
        </Head>

        <main className="container margin-vert--lg">
          <div className="row">
            <div className="col col--offset-0">
              <h1 className="hero__title">
                🚀 <span className="topBannerTitleText_Ferb">→akaSearch = Search for aka.ms!</span>
              </h1>
              <p>🗣️ Do you have trouble remembering Microsoft's <a href="https://akaSearch.net">aka.ms</a> links. This community contributed list of links is for you! Use the Add button to submit new links to this list.</p>
            </div>
            <div className="col col--offset-0">
              <CommandsTable columns={columns} data={commands} applyFilter="" />
            </div>
          </div>
        </main>
      </Layout>
    </>
  );
}
