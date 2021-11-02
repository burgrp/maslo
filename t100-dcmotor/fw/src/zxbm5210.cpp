#include "silicon.hpp"

class ZXBM5210 {

  int pinFwd;
  int pinRev;

  PWM pwm;

public:
  void init(int pinFwd, int pinRev, volatile target::tc::Peripheral *tcPwm) {

    pwm.init(tcPwm);

    this->pinFwd = pinFwd;
    this->pinRev = pinRev;

    target::PORT.OUTCLR.setOUTCLR(1 << pinFwd | 1 << pinRev);
    
    target::PORT.DIRSET.setDIRSET(1 << pinFwd | 1 << pinRev);

    setPortMux(pinFwd);
    setPortMux(pinRev);
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

    target::PORT.PINCFG[pinFwd].setPMUXEN(duty && direction);
    target::PORT.PINCFG[pinRev].setPMUXEN(duty && !direction);

    // target::PORT.OUTCLR.setOUTCLR(1 << pinInA | 1 << pinInB);
    //   pwm.set(duty);
    //   if (direction) {
    //     target::PORT.OUTSET.setOUTSET(1 << pinInB);
    //   } else {
    //     target::PORT.OUTSET.setOUTSET(1 << pinInA);
    //   }
  }
};