// Club colours for the dot next to a club's name: the shirt fills it, the
// second colour rings it. Sofascore's spelling, both seasons on the site.
// Picked by hand, close enough rather than exact.

const COLOURS = {
  // Premier League
  "Arsenal": ["#ef0107", "#ffffff"],
  "Aston Villa": ["#670e36", "#95bfe5"],
  "Bournemouth": ["#da291c", "#111111"],
  "Brentford": ["#e30613", "#ffffff"],
  "Brighton & Hove Albion": ["#0057b8", "#ffffff"],
  "Burnley": ["#6c1d45", "#99d6ea"],
  "Chelsea": ["#034694", "#ffffff"],
  "Coventry City": ["#59cbe8", "#ffffff"],
  "Crystal Palace": ["#1b458f", "#c4122e"],
  "Everton": ["#003399", "#ffffff"],
  "Fulham": ["#ffffff", "#111111"],
  "Hull City": ["#f5a12d", "#111111"],
  "Ipswich Town": ["#3a64a3", "#ffffff"],
  "Leeds United": ["#ffffff", "#1d428a"],
  "Liverpool FC": ["#c8102e", "#c8102e"],
  "Manchester City": ["#6cabdd", "#ffffff"],
  "Manchester United": ["#da291c", "#111111"],
  "Newcastle United": ["#111111", "#ffffff"],
  "Nottingham Forest": ["#dd0000", "#ffffff"],
  "Sunderland": ["#eb172b", "#ffffff"],
  "Tottenham Hotspur": ["#ffffff", "#132257"],
  "West Ham United": ["#7a263a", "#1bb1e7"],
  "Wolverhampton": ["#fdb913", "#231f20"],
  // La Liga
  "Athletic Club": ["#ee2523", "#ffffff"],
  "Atlético Madrid": ["#cb3524", "#272e61"],
  "Celta Vigo": ["#8ac3ee", "#ffffff"],
  "Deportivo Alavés": ["#0761af", "#ffffff"],
  "Deportivo de A Coruña": ["#1b4e9b", "#ffffff"],
  "Elche": ["#ffffff", "#05642c"],
  "Espanyol": ["#007fc8", "#ffffff"],
  "FC Barcelona": ["#004d98", "#a50044"],
  "Getafe": ["#005999", "#005999"],
  "Girona FC": ["#cd2534", "#ffffff"],
  "Levante UD": ["#b4053f", "#004b97"],
  "Málaga CF": ["#3a87c8", "#ffffff"],
  "Mallorca": ["#e20613", "#111111"],
  "Osasuna": ["#d91a21", "#0a346f"],
  "Rayo Vallecano": ["#ffffff", "#e53027"],
  "Real Betis": ["#00954c", "#ffffff"],
  "Real Madrid": ["#ffffff", "#febe10"],
  "Real Oviedo": ["#0055a4", "#ffffff"],
  "Real Racing Club": ["#ffffff", "#00a650"],
  "Real Sociedad": ["#0067b1", "#ffffff"],
  "Sevilla": ["#ffffff", "#d71920"],
  "Valencia": ["#ffffff", "#111111"],
  "Villarreal": ["#ffe114", "#005187"],
};

export function clubMark(team) {
  const mark = document.createElement("span");
  mark.className = "club";
  mark.setAttribute("aria-hidden", "true");
  const c = COLOURS[team];
  if (c) {
    mark.style.setProperty("--shirt", c[0]);
    mark.style.setProperty("--trim", c[1]);
  }
  return mark;
}
