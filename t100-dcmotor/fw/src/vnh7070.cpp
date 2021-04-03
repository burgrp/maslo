class VNH7070 {

  int pinInA;
  int pinInB;
  int pinSel0;

  PWM pwm;

public:
  void init(int pinInA, int pinInB, int pinPwm, int pinSel0, volatile target::tc::Peripheral *tcPwm) {

    pwm.init(tcPwm, pinPwm);

    this->pinInA = pinInA;
    this->pinInB = pinInB;
    this->pinSel0 = pinSel0;

    target::PORT.OUTCLR.setOUTCLR(1 << pinInA | 1 << pinInB | 1 << pinSel0);
    target::PORT.DIRSET.setDIRSET(1 << pinInA | 1 << pinInB | 1 << pinSel0);
  }
  void set(unsigned int speed, bool direction) {
    target::PORT.OUTCLR.setOUTCLR(1 << pinInA | 1 << pinInB | 1 << pinSel0);
    pwm.set(speed);
    //if (speed) {
      if (direction) {
        target::PORT.OUTSET.setOUTSET(1 << pinInB);
      } else {
        target::PORT.OUTSET.setOUTSET(1 << pinInA | 1 << pinSel0);
      }
    //}
  }
};