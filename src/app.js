const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");
const cors = require("cors");
const puppeteer = require("puppeteer");
const puppeteerConfig = require("../.puppeteerrc.cjs");

const app = express();
const port = process.env.PORT || 8000; //http://127.0.0.1:8000/scrape-blog

app.use(cors());
app.use(bodyParser.json());
app.use(express.json());
//webhook
//https://hooks.zapier.com/hooks/catch/11217441/bfemddr/

//gsheet
//https://docs.google.com/spreadsheets/d/179sBi60qMY23UZrq_p4kPBQHAZvrHc2BvR5_ADgzsCc
const { google } = require("googleapis");
const sheets = google.sheets("v4");
const credentials = require("../credentials.json");
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheetsAPI = sheets.spreadsheets.values;

app.post("/scrape", async (req, res) => {
  eraseDataOnSheet();

  const CATEGORY = req.body.category;
  const WEBHOOK = req.body.webhook;
  const BASE_URL = `https://xepelin.com/blog/${CATEGORY}`;

  //category could be:
  //  empresarios-exitosos
  //  pymes
  //  emprendedores
  //  educacion-financiera
  //  corporativos
  //  noticias

  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

  //Load all articles of category
  let clicked = true;
  while (clicked) {
    let button;
    try {
      button = await page.waitForSelector(
        ".Button_root__G_l9X.Button_filled__GEop3.Button_medium__zCMU6",
        {
          visible: true,
          timeout: 2000,
        }
      );
    } catch {
      button = false;
    }

    if (button) {
      await page.click(
        ".Button_root__G_l9X.Button_filled__GEop3.Button_medium__zCMU6"
      );
    } else {
      clicked = false;
    }
  }

  await page.waitForSelector(
    ".BlogArticlesPagination_articlesGridNormal__CYdsq"
  );

  //get links of each article into an array
  const hrefs = await page.evaluate(() => {
    const linkElements = Array.from(
      document.querySelectorAll(
        ".BlogArticlesPagination_articleNormal__wvB1u a"
      )
    );
    return linkElements.map((link) => link.getAttribute("href"));
  });

  let pagePromise = (link) =>
    new Promise(async (resolve, reject) => {
      let dataObj = {};
      let newPage = await browser.newPage();
      await newPage.goto(link);

      const READ_TIME = await newPage.evaluate(async () => {
        const outerDiv = document.querySelector(".BlogCL_root__kW7Oz");
        const innerDiv = outerDiv.querySelector(
          ".sc-fe594033-0.ioYqnu.text-grey-600.Text_body__ldD0k"
        );
        return innerDiv.textContent;
      });

      const TITLE = await newPage.evaluate(async () => {
        const outerDiv = document.querySelector(".BlogCL_root__kW7Oz");
        const innerDiv = outerDiv.querySelector(
          ".sc-fe594033-0.ioYqnu.ArticleSingle_title__s6dVD.Text_pageHeading__VhZNf"
        );
        return innerDiv.textContent;
      });

      dataObj["title"] = TITLE;
      dataObj["category"] = CATEGORY;
      dataObj["reading_time"] = READ_TIME;

      resolve(dataObj);
      await newPage.close();
    });

  for (link in hrefs) {
    const currentPageData = await pagePromise(hrefs[link]);
    appendDataToSheet(currentPageData);
  }

  const postData = {
    email: "felipe.besa@xepelin.com",
    link: "https://docs.google.com/spreadsheets/d/179sBi60qMY23UZrq_p4kPBQHAZvrHc2BvR5_ADgzsCc",
  };

  await axios.post(WEBHOOK, postData, {
    headers: {
      "Content-Type": "application/json",
    },
  });

  const response = {
    message: "Scraping and processing initiated",
  };
  res.status(200).json(response);

  await browser.close();
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

async function eraseDataOnSheet() {
  const spreadsheetId = "179sBi60qMY23UZrq_p4kPBQHAZvrHc2BvR5_ADgzsCc";
  const range = "scraper";

  await sheetsAPI.clear({
    auth,
    spreadsheetId,
    range,
  });
}

async function appendDataToSheet(data) {
  const spreadsheetId = "179sBi60qMY23UZrq_p4kPBQHAZvrHc2BvR5_ADgzsCc";
  const range = "scraper";

  try {
    const res = await sheetsAPI.append({
      auth,
      spreadsheetId,
      range,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      resource: {
        values: [Object.values(data)],
      },
    });
  } catch (error) {
    console.error("Error appending data:", error);
  }
}
