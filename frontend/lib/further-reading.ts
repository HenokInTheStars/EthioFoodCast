/**
 * The knowledge centre's hand-picked reading list. Every link goes to the
 * publisher's own page; nothing here is copied or sent to the AI assistant.
 * Check the links when editing: some publishers move pages without redirects.
 */
export type ReadingItem = { title: string; publisher: string; note: string; url: string };
export type ReadingGroup = { id: string; heading: string; items: ReadingItem[] };

export const furtherReading: ReadingGroup[] = [
  {
    id: "data",
    heading: "The data behind the model",
    items: [
      {
        title: "Ethiopia Socioeconomic Survey 2018-2019 (ESS4)",
        publisher: "World Bank Microdata Library",
        note: "The survey round whose answers the model learns from.",
        url: "https://microdata.worldbank.org/index.php/catalog/3823",
      },
      {
        title: "Ethiopia Socio-Economic Panel Survey 2021-2022 (ESPS-5)",
        publisher: "World Bank Microdata Library",
        note: "The follow-up round that recorded which households were food insecure.",
        url: "https://microdata.worldbank.org/index.php/catalog/6161",
      },
      {
        title: "Living Standards Measurement Study – Integrated Surveys on Agriculture",
        publisher: "World Bank",
        note: "The programme behind the surveys, with documentation for each country.",
        url: "https://www.worldbank.org/en/programs/lsms/initiatives/lsms-ISA",
      },
    ],
  },
  {
    id: "measuring",
    heading: "How hunger is measured",
    items: [
      {
        title: "Food Insecurity Experience Scale",
        publisher: "FAO",
        note: "The eight-question scale this project uses to define food insecurity.",
        url: "https://www.fao.org/measuring-hunger/en",
      },
      {
        title: "Integrated Food Security Phase Classification (IPC)",
        publisher: "IPC partners",
        note: "The common scale agencies use to classify how severe a food crisis is.",
        url: "https://www.ipcinfo.org/",
      },
      {
        title: "Global Report on Food Crises",
        publisher: "Food Security Information Network",
        note: "The yearly review of acute food insecurity around the world.",
        url: "https://www.fsinplatform.org/",
      },
    ],
  },
  {
    id: "ethiopia",
    heading: "Food security in Ethiopia today",
    items: [
      {
        title: "Ethiopia food security outlook",
        publisher: "FEWS NET",
        note: "Regular outlooks and alerts, useful for checking current conditions.",
        url: "https://fews.net/east-africa/ethiopia",
      },
      {
        title: "WFP in Ethiopia",
        publisher: "World Food Programme",
        note: "Country briefs, programmes and evaluations.",
        url: "https://www.wfp.org/countries/ethiopia",
      },
      {
        title: "FAO in Ethiopia",
        publisher: "Food and Agriculture Organization",
        note: "Agriculture, livelihoods and food security work in Ethiopia.",
        url: "https://www.fao.org/ethiopia/en/",
      },
    ],
  },
];
