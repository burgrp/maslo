class TB67H451FNG {

  int pinMotor1;
  int pinMotor2;

  PWM pwm;

public:
  void init(int pinMotor1, int pinMotor2, volatile target::tc::Peripheral *tcPwm) {

    pwm.init(tcPwm);

    this->pinMotor1 = pinMotor1;
    this->pinMotor2 = pinMotor2;

    target::PORT.OUTCLR.setOUTCLR(1 << pinMotor1 | 1 << pinMotor2);

    target::PORT.DIRSET.setDIRSET(1 << pinMotor1 | 1 << pinMotor2);

    setPortMux(pinMotor1);
    setPortMux(pinMotor2);
  }

  void setPortMux(int pin) {
    if (pin & 1) {
      target::PORT.PMUX[pin >> 1].setPMUXO(target::port::PMUX::PMUXO::E);
    } else {
      target::PORT.PMUX[pin >> 1].setPMUXE(target::port::PMUX::PMUXE::E);
    }
  }

  void set(unsigned char duty, bool direction) {

    pwm.set(duty);
    target::PORT.PINCFG[pinMotor1].setPMUXEN(duty && direction);
    target::PORT.PINCFG[pinMotor2].setPMUXEN(duty && !direction);
  }
};