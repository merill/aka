import React from "react";
import Translate, { translate } from "@docusaurus/Translate";
import { PageMetadata } from "@docusaurus/theme-common";
import Layout from "@theme/Layout";
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
        <main className="container margin-vert--lg">
          <div className="row">
            <div className="col col--offset-0">
              <h1 className="hero__title">
                🚀 <span className="topBannerTitleText_Ferb">→aka.cmd.ms = Search for aka.ms!</span>
              </h1>
              <p>🗣️ Is your favorite aka.ms link missing? <a href='https://github.com/aka/issues/...'>Click here to add aka.ms link.</a></p>
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
