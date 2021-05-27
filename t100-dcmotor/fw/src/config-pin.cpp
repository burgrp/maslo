int readConfigPin(int pin) {
  
  target::PORT.DIRCLR = 1 << pin;
  target::PORT.PINCFG[pin].setINEN(true).setPULLEN(true);

  target::PORT.OUTSET = 1 << pin;
  int puValue = (target::PORT.IN >> pin) & 1;

  target::PORT.OUTCLR = 1 << pin;
  int pdValue = (target::PORT.IN >> pin) & 1;

  target::PORT.PINCFG[pin].setINEN(false).setPULLEN(false);

  return (puValue && pdValue)? 1: (!puValue && !pdValue)? 0: 2;
}
