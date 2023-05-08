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
          <meta property="og:url" content="https://aka.cmd.ms" />
          <meta property="og:type" content="website" />
          <meta property="og:title" content="Search aka.ms" />
          <meta property="og:description" content="Use this page to search for aka.ms links that have been contributed to by the community." />
          <meta property="og:image" content="https://aka.cmd.ms/OpenGraphImage.png" />
          <meta property="og:image:alt" content="Screenshot of aka.cmd.ms home page with the text 'Looking for aka.ms links? Find them at aka.cmd.ms'" />

          <meta name="twitter:card" content="summary_large_image" />
          <meta property="twitter:domain" content="aka.cmd.ms" />
          <meta property="twitter:site" content="@merill" />
          <meta property="twitter:url" content="https://aka.cmd.ms" />
          <meta name="twitter:title" content="Search aka.ms" />
          <meta name="twitter:description" content="Use this page to search for aka.ms links that have been contributed to by the community." />
          <meta name="twitter:image" content="https://aka.cmd.ms/OpenGraphImage.png" />
          <meta property="twitter:image:alt" content="Screenshot of aka.cmd.ms home page with the text 'Looking for aka.ms links? Find them at aka.cmd.ms'" />
        </Head>

        <main className="container margin-vert--lg">
          <div className="row">
            <div className="col col--offset-0">
              <h1 className="hero__title">
                🚀 <span className="topBannerTitleText_Ferb">→aka.cmd.ms = Search for aka.ms!</span>
              </h1>
              <p>🗣️ This page is a community contributed list of <a href="https://aka.cmd.ms">aka.ms</a> links. Use the Add button to submit new links to this list.</p>
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
