/* =========================================================
   ASCII ART DEFINITIONS
   Each role has its own progression by stage
   stage 0 = starting
   stage 1 = mid
   stage 2 = advanced
   ========================================================= */

var ASCII_ART = {
  general_store: {
    0: `

[______] _.  A Cart
|______|/
 O    O
`,

       
1: `
   .____.
  /_/__\_\  A Town Stall
   |    |
  ========
`,
    2: `
   _____________
  | GENERAL     |
  |  STORE      |
  |  _________  |
  | |  OPEN   | |
  |_|_________|_|
`
  },

  blacksmith: {
    0: `
   (  )
  (    )   Small Forge
   )__(
  /____\\
`,
    1: `
   ____ 
 _/ __ \\_   Anvil Station
|__|  |__|
   /__\\
`,
    2: `
   _____________
  | BLACKSMITH  |
  |  _________  |
  | |  OPEN   | |
  |_|_________|_|
`
  },

  boarding_house: {
    0: `
  __________
 |  ROOM #1 |  Spare Room
 |__________|
 |__|    |__|
`,
    1: `
  _____________
 |  DINING HALL|  Meal Service
 |__  ____  ___|
    ||____||
`,
    2: `
   _______________
  | THE BOARDING  |
  |     HOUSE     |
  |  ___________  |
  | |   OPEN    | |
  |_|___________|_|
`
  }
};

/* =========================================================
   TOWN-WIDE ASCII (not role-specific)
   ========================================================= */

var TOWN_ASCII = {
  bank: `
   ___________
   \_B_A_N_K_/        
   |  __     |       
   | |  |    |       
   |_|__|____|    
`,

  gazette: `
  @""""""""""""""""""""@
  |  THE TOWN GAZETTE  |
  '--------------------'
`
};
