//+------------------------------------------------------------------+
//|                                    FX_Positions_Webhook.mq5      |
//|                                    Envia posiciones al bot       |
//+------------------------------------------------------------------+
#property copyright "RastrearBot"
#property version   "1.1"
#property description "Envia posiciones abiertas a api.rastrear.com.co"
#property description "Comando fx por WhatsApp para consultar"

input string   WebhookURL = "https://api.rastrear.com.co/api/fx/positions";
input string   WebhookSecret = "mt5_secret_2026";
input long     AccountNumber = 341569948;
input int      UpdateIntervalSeconds = 30;
input bool     SendOnlyWhenChanged = true;
input bool     ShowDebugLogs = true;

datetime gLastSendTime;
string gLastHash;

int OnInit()
{
   if(UpdateIntervalSeconds < 10)
   {
      Print("Intervalo minimo: 10 segundos");
      return INIT_PARAMETERS_INCORRECT;
   }
   
   gLastSendTime = 0;
   gLastHash = "";
   
   Print("FX Positions Webhook iniciado - Cuenta: ", AccountNumber);
   
   EventSetTimer(3);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTimer()
{
   int total = PositionsTotal();
   if(total == 0) { return; }
   
   datetime now = TimeCurrent();
   if(now - gLastSendTime < UpdateIntervalSeconds) { return; }
   
   gLastSendTime = now;
   
   string json = BuildJSON(total);
   if(json == "") { return; }
   
   if(SendOnlyWhenChanged)
   {
      if(json == gLastHash) { return; }
   }
   
   gLastHash = json;
   SendRequest(json);
}

string BuildJSON(int total)
{
   string arr = "[";
   bool comma = false;
   
   for(int i = 0; i < total; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) { continue; }
      
      PositionSelectByTicket(ticket);
      
      string symbol = PositionGetString(POSITION_SYMBOL);
      long posType = PositionGetInteger(POSITION_TYPE);
      double lots = PositionGetDouble(POSITION_VOLUME);
      double openP = PositionGetDouble(POSITION_PRICE_OPEN);
      double curP = PositionGetDouble(POSITION_PRICE_CURRENT);
      double sl = PositionGetDouble(POSITION_SL);
      double tp = PositionGetDouble(POSITION_TP);
      double profit = PositionGetDouble(POSITION_PROFIT);
      double swap = PositionGetDouble(POSITION_SWAP);
      datetime openTime = (datetime)PositionGetInteger(POSITION_TIME);
      
      int dig = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
      
      double profitPct = 0;
      if(openP > 0 && lots > 0)
      {
         profitPct = (profit / (lots * openP)) * 100;
      }
      
      string typeStr = "BUY";
      if(posType == 1) { typeStr = "SELL"; }
      
      if(comma) { arr += ","; }
      comma = true;
      
      arr += "{";
      arr += "\"ticket\":\"" + IntegerToString(ticket) + "\",";
      arr += "\"symbol\":\"" + symbol + "\",";
      arr += "\"type\":\"" + typeStr + "\",";
      arr += "\"lots\":" + DoubleToString(lots, 2) + ",";
      arr += "\"openPrice\":" + DoubleToString(openP, dig) + ",";
      arr += "\"currentPrice\":" + DoubleToString(curP, dig) + ",";
      
      if(sl > 0)
      {
         arr += "\"stopLoss\":" + DoubleToString(sl, dig) + ",";
      }
      
      if(tp > 0)
      {
         arr += "\"takeProfit\":" + DoubleToString(tp, dig) + ",";
      }
      
      arr += "\"profit\":" + DoubleToString(profit, 2) + ",";
      arr += "\"profitPct\":" + DoubleToString(profitPct, 2) + ",";
      arr += "\"swap\":" + DoubleToString(swap, 2) + ",";
      arr += "\"commission\":" + DoubleToString(0, 2) + ",";
      
      // Horas abierta
      long hoursOpen = (TimeCurrent() - openTime) / 3600;
      arr += "\"hoursOpen\":" + IntegerToString(hoursOpen) + ",";
      
      // Distancia a SL en pips
      double slDist = 0;
      if(sl > 0)
      {
         double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
         if(posType == 0) { slDist = (curP - sl) / point; }
         else { slDist = (sl - curP) / point; }
      }
      arr += "\"slPips\":" + DoubleToString(slDist, 0) + ",";
      
      // Distancia a TP en pips
      double tpDist = 0;
      if(tp > 0)
      {
         double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
         if(posType == 0) { tpDist = (tp - curP) / point; }
         else { tpDist = (curP - tp) / point; }
      }
      arr += "\"tpPips\":" + DoubleToString(tpDist, 0) + ",";
      
      arr += "\"openTime\":\"" + TimeToString(openTime, TIME_DATE|TIME_MINUTES|TIME_SECONDS) + "\"";
      arr += "}";
   }
   
   arr += "]";
   
   if(!comma) { return ""; }
   
   string full = "{";
   full += "\"webhookSecret\":\"" + WebhookSecret + "\",";
   full += "\"accountNumber\":\"" + IntegerToString(AccountNumber) + "\",";
   
   // Datos de cuenta para alertas
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   double margin = AccountInfoDouble(ACCOUNT_MARGIN);
   double marginFree = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   double marginLevel = (margin > 0) ? (equity / margin) * 100 : 0;
   double profitDay = equity - balance; // Profit/Pérdida flotante del día
   
   full += "\"account\":{";
   full += "\"balance\":" + DoubleToString(balance, 2) + ",";
   full += "\"equity\":" + DoubleToString(equity, 2) + ",";
   full += "\"margin\":" + DoubleToString(margin, 2) + ",";
   full += "\"marginFree\":" + DoubleToString(marginFree, 2) + ",";
   full += "\"marginLevel\":" + DoubleToString(marginLevel, 1) + ",";
   full += "\"floatingPnL\":" + DoubleToString(profitDay, 2);
   full += "},";
   
   full += "\"positions\":" + arr;
   full += "}";
   
   return full;
}

void SendRequest(string json)
{
   char body[];
   char result[];
   string headers;
   
   int len = StringLen(json);
   StringToCharArray(json, body, 0, len);
   
   int code = WebRequest(
      "POST",
      WebhookURL,
      "Content-Type: application/json\r\n",
      5000,
      body,
      result,
      headers
   );
   
   if(code == 200)
   {
      string resp = CharArrayToString(result);
      if(ShowDebugLogs)
      {
         Print("Posiciones actualizadas: ", resp);
      }
   }
   else
   {
      Print("Error HTTP ", code, " - Verifica WebRequest en Herramientas > Opciones > Asesores Expertos");
   }
}

void OnTick()
{
}
