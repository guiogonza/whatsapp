//+------------------------------------------------------------------+
//|                                    FX_Alerts_Webhook.mq5         |
//|                                    Envía alertas de trading al   |
//|                                    bot de WhatsApp vía webhook   |
//+------------------------------------------------------------------+
#property copyright "RastrearBot"
#property version   "1.0"
#property description "Envía alertas de trading a api.rastrear.com.co"
#property description "Señales, SL/TP, apertura/cierre de posiciones"

// --- CONFIGURACIÓN ---
input string   WebhookURL = "https://api.rastrear.com.co/api/fx/notify";       // URL del webhook
input string   WebhookSecret = "mt5_secret_2026";                               // Secret
input long     AccountNumber = 341569948;                                        // Cuenta
input bool     NotifyNewPositions = true;                                        // Notificar nuevas posiciones
input bool     NotifyClosedPositions = true;                                     // Notificar cierre de posiciones
input bool     NotifySLTPHit = true;                                             // Notificar SL/TP alcanzado
input bool     NotifyAlerts = true;                                              // Notificar alertas del terminal
input bool     ShowDebugLogs = true;                                             // Mostrar logs

// --- VARIABLES GLOBALES ---
int lastPositionsTotal = 0;
ulong knownTickets[];      // Tickets que ya conocemos
double knownProfits[];     // Último profit conocido de cada ticket  
datetime lastKnownTimes[]; // Última vez que vimos cada ticket

//+------------------------------------------------------------------+
//| Expert initialization                                             |
//+------------------------------------------------------------------+
int OnInit()
{
   Print("🚀 FX Alerts Webhook iniciado");
   Print("   URL: ", WebhookURL);
   Print("   Cuenta: ", AccountNumber);
   Print("   Alertas: Nuevas=", NotifyNewPositions, " Cerradas=", NotifyClosedPositions, " SL/TP=", NotifySLTPHit);
   
   // Inicializar estado
   lastPositionsTotal = PositionsTotal();
   SyncKnownPositions();
   
   EventSetTimer(3); // Revisar cada 3 segundos
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| Expert deinitialization                                           |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   Print("👋 FX Alerts Webhook detenido");
}

//+------------------------------------------------------------------+
//| Timer - detecta cambios en posiciones                             |
//+------------------------------------------------------------------+
void OnTimer()
{
   int currentTotal = PositionsTotal();
   
   // Detectar NUEVAS posiciones
   if(currentTotal > lastPositionsTotal && NotifyNewPositions)
   {
      for(int i = 0; i < currentTotal; i++)
      {
         ulong ticket = PositionGetTicket(i);
         if(!IsTicketKnown(ticket) && PositionSelectByTicket(ticket))
         {
            SendNewPositionAlert(ticket);
            AddKnownTicket(ticket);
         }
      }
   }
   
   // Detectar POSICIONES CERRADAS
   if(currentTotal < lastPositionsTotal && NotifyClosedPositions)
   {
      for(int i = 0; i < ArraySize(knownTickets); i++)
      {
         if(!IsTicketOpen(knownTickets[i]) && knownProfits[i] != EMPTY_VALUE)
         {
            SendClosedPositionAlert(knownTickets[i], knownProfits[i]);
            knownProfits[i] = EMPTY_VALUE; // Marcar como procesado
         }
      }
   }
   
   // Detectar SL/TP alcanzado
   if(NotifySLTPHit)
   {
      for(int i = 0; i < currentTotal; i++)
      {
         ulong ticket = PositionGetTicket(i);
         if(PositionSelectByTicket(ticket))
         {
            double sl = PositionGetDouble(POSITION_SL);
            double tp = PositionGetDouble(POSITION_TP);
            double currentPrice = PositionGetDouble(POSITION_PRICE_CURRENT);
            long type = PositionGetInteger(POSITION_TYPE);
            
            if(sl > 0 && type == 0 && currentPrice <= sl) // BUY SL hit
            {
               SendSLTPAlert(ticket, "SL", sl, currentPrice);
            }
            else if(sl > 0 && type == 1 && currentPrice >= sl) // SELL SL hit
            {
               SendSLTPAlert(ticket, "SL", sl, currentPrice);
            }
            else if(tp > 0 && type == 0 && currentPrice >= tp) // BUY TP hit
            {
               SendSLTPAlert(ticket, "TP", tp, currentPrice);
            }
            else if(tp > 0 && type == 1 && currentPrice <= tp) // SELL TP hit
            {
               SendSLTPAlert(ticket, "TP", tp, currentPrice);
            }
         }
      }
   }
   
   // Actualizar profits conocidos
   UpdateKnownProfits();
   
   lastPositionsTotal = currentTotal;
}

//+------------------------------------------------------------------+
//| Envía alerta de NUEVA posición                                   |
//+------------------------------------------------------------------+
void SendNewPositionAlert(ulong ticket)
{
   string symbol = PositionGetString(POSITION_SYMBOL);
   long type = PositionGetInteger(POSITION_TYPE);
   double lots = PositionGetDouble(POSITION_VOLUME);
   double openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
   double sl = PositionGetDouble(POSITION_SL);
   double tp = PositionGetDouble(POSITION_TP);
   
   string typeStr = (type == 0) ? "BUY" : "SELL";
   string emoji = (type == 0) ? "📈" : "📉";
   
   string message = emoji + " *NUEVA POSICIÓN*\n\n";
   message += "*Ticket:* #" + IntegerToString(ticket) + "\n";
   message += "*Símbolo:* " + symbol + " | " + typeStr + " " + DoubleToString(lots, 2) + " lot\n";
   message += "*Apertura:* " + DoubleToString(openPrice, (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS)) + "\n";
   if(sl > 0) message += "*SL:* " + DoubleToString(sl, (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS)) + " | ";
   if(tp > 0) message += "*TP:* " + DoubleToString(tp, (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS));
   message += "\n⏰ " + TimeToString(TimeCurrent(), TIME_DATE|TIME_MINUTES);
   
   SendWebhook("position", message);
   Print("📈 Nueva posición enviada: #", ticket, " ", symbol, " ", typeStr);
}

//+------------------------------------------------------------------+
//| Envía alerta de posición CERRADA                                 |
//+------------------------------------------------------------------+
void SendClosedPositionAlert(ulong ticket, double finalProfit)
{
   // Buscar en el historial
   if(!HistorySelectByPosition(ticket))
   {
      Print("⚠️ No se encontró historial para ticket #", ticket);
      return;
   }
   
   string symbol = "";
   string typeStr = "";
   double lots = 0;
   double openPrice = 0;
   double closePrice = 0;
   
   for(int i = 0; i < HistoryDealsTotal(); i++)
   {
      ulong dealTicket = HistoryDealGetTicket(i);
      if(HistoryDealGetInteger(dealTicket, DEAL_POSITION_ID) == ticket)
      {
         if(HistoryDealGetInteger(dealTicket, DEAL_ENTRY) == DEAL_ENTRY_OUT)
         {
            symbol = HistoryDealGetString(dealTicket, DEAL_SYMBOL);
            closePrice = HistoryDealGetDouble(dealTicket, DEAL_PRICE);
         }
         else if(HistoryDealGetInteger(dealTicket, DEAL_ENTRY) == DEAL_ENTRY_IN)
         {
            typeStr = (HistoryDealGetInteger(dealTicket, DEAL_TYPE) == 0) ? "BUY" : "SELL";
            lots = HistoryDealGetDouble(dealTicket, DEAL_VOLUME);
            openPrice = HistoryDealGetDouble(dealTicket, DEAL_PRICE);
         }
      }
   }
   
   string emoji = finalProfit >= 0 ? "💰" : "📛";
   string sign = finalProfit >= 0 ? "+" : "";
   
   string message = emoji + " *POSICIÓN CERRADA*\n\n";
   message += "*Ticket:* #" + IntegerToString(ticket) + "\n";
   if(symbol != "") message += "*Símbolo:* " + symbol + " " + typeStr + " " + DoubleToString(lots, 2) + " lot\n";
   message += "*Profit Final:* " + sign + "$" + DoubleToString(finalProfit, 2) + "\n";
   message += "\n⏰ " + TimeToString(TimeCurrent(), TIME_DATE|TIME_MINUTES);
   
   SendWebhook("position", message);
   Print("📛 Posición cerrada: #", ticket, " Profit: $", finalProfit);
}

//+------------------------------------------------------------------+
//| Envía alerta de SL/TP                                             |
//+------------------------------------------------------------------+
void SendSLTPAlert(ulong ticket, string sltpType, double level, double current)
{
   string symbol = "";
   if(PositionSelectByTicket(ticket))
      symbol = PositionGetString(POSITION_SYMBOL);
   
   string emoji = (sltpType == "TP") ? "🎯" : "🛑";
   
   string message = emoji + " *" + sltpType + " ALCANZADO*\n\n";
   message += "*Ticket:* #" + IntegerToString(ticket) + "\n";
   if(symbol != "") message += "*Símbolo:* " + symbol + "\n";
   message += "*Nivel " + sltpType + ":* " + DoubleToString(level, 5) + "\n";
   message += "*Precio Actual:* " + DoubleToString(current, 5) + "\n";
   message += "\n⏰ " + TimeToString(TimeCurrent(), TIME_DATE|TIME_MINUTES);
   
   SendWebhook("alert", message);
   Print("⚠️ ", sltpType, " alcanzado: #", ticket);
}

//+------------------------------------------------------------------+
//| Envía el webhook POST                                            |
//+------------------------------------------------------------------+
void SendWebhook(string alertType, string message)
{
   string json = "{";
   json += "\"type\":\"" + alertType + "\",";
   json += "\"accountNumber\":\"" + IntegerToString(AccountNumber) + "\",";
   json += "\"webhookSecret\":\"" + WebhookSecret + "\",";
   json += "\"data\":{";
   json += "\"type\":\"" + alertType + "\",";
   json += "\"message\":\"" + message + "\"";
   json += "}}";
   
   char postData[];
   char resultData[];
   string resultHeaders;
   
   StringToCharArray(json, postData, 0, StringLen(json));
   
   int res = WebRequest("POST", WebhookURL, "Content-Type: application/json\r\n", 5000, postData, resultData, resultHeaders);
   
   if(res == 200 && ShowDebugLogs)
      Print("✅ Alerta enviada: ", alertType);
   else if(res != 200)
      Print("❌ Error enviando alerta. HTTP: ", res, " - Agrega api.rastrear.com.co a WebRequest permitidas");
}

//+------------------------------------------------------------------+
//| Helpers para tracking de tickets                                 |
//+------------------------------------------------------------------+
void SyncKnownPositions()
{
   int total = PositionsTotal();
   ArrayResize(knownTickets, total);
   ArrayResize(knownProfits, total);
   ArrayResize(lastKnownTimes, total);
   
   for(int i = 0; i < total; i++)
   {
      knownTickets[i] = PositionGetTicket(i);
      if(PositionSelectByTicket(knownTickets[i]))
      {
         knownProfits[i] = PositionGetDouble(POSITION_PROFIT);
         lastKnownTimes[i] = TimeCurrent();
      }
   }
}

bool IsTicketKnown(ulong ticket)
{
   for(int i = 0; i < ArraySize(knownTickets); i++)
      if(knownTickets[i] == ticket) return true;
   return false;
}

bool IsTicketOpen(ulong ticket)
{
   for(int i = 0; i < PositionsTotal(); i++)
      if(PositionGetTicket(i) == ticket) return true;
   return false;
}

void AddKnownTicket(ulong ticket)
{
   int size = ArraySize(knownTickets);
   ArrayResize(knownTickets, size + 1);
   ArrayResize(knownProfits, size + 1);
   ArrayResize(lastKnownTimes, size + 1);
   
   knownTickets[size] = ticket;
   knownProfits[size] = 0;
   lastKnownTimes[size] = TimeCurrent();
}

void UpdateKnownProfits()
{
   for(int i = 0; i < ArraySize(knownTickets); i++)
   {
      if(PositionSelectByTicket(knownTickets[i]))
      {
         knownProfits[i] = PositionGetDouble(POSITION_PROFIT);
         lastKnownTimes[i] = TimeCurrent();
      }
   }
}

//+------------------------------------------------------------------+
void OnTick() { /* Timer-driven, no se usa OnTick */ }
