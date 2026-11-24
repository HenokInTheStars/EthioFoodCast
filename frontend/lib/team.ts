/**
 * The people who built EthioFoodCast. Shown in the site footer; the README and
 * content/knowledge/01-about.md list the same details, so update them together.
 */
export type TeamMember = { name: string; role: string; linkedin: string; github: string };

export const team: TeamMember[] = [
  {
    name: "Henok Solomon",
    role: "Data and frontend",
    linkedin: "https://www.linkedin.com/in/henok-solomon-ai/",
    github: "https://github.com/HenokInTheStars",
  },
  {
    name: "Niyat Debesay",
    role: "Machine learning and backend",
    linkedin: "https://www.linkedin.com/in/niyat-debesay-6890b5285/",
    github: "https://github.com/niyatdebesay",
  },
  {
    name: "Amina Aman",
    role: "Product and analytics",
    linkedin: "https://www.linkedin.com/in/amina-aman-6a475333a/",
    github: "https://github.com/aminaaman44",
  },
];
