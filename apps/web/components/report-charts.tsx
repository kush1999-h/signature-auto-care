import { Line, LineChart, ResponsiveContainer, XAxis, YAxis, Tooltip, BarChart, Bar, PieChart, Pie, Cell } from "recharts";

const palette = {
  red: "#CA0B2F",
  gray: "#989898",
  blue: "#0B53D7"
};
const colors = [palette.red, palette.blue, palette.gray, palette.gray];

export function RevenueLine({ data }: { data: { date: string; revenue: number; expenses?: number }[] }) {
  return (
    <div className="glass p-4 rounded-xl h-64">
      <p className="text-sm text-muted-foreground mb-2">Revenue vs Expenses</p>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <XAxis dataKey="date" stroke={palette.gray} />
          <YAxis stroke={palette.gray} />
          <Tooltip />
          <Line type="monotone" dataKey="revenue" stroke={palette.red} strokeWidth={2} />
          <Line type="monotone" dataKey="expenses" stroke={palette.blue} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BreakdownPie({ data }: { data: { name: string; value: number }[] }) {
  return (
    <div className="glass p-4 rounded-xl h-64">
      <p className="text-sm text-muted-foreground mb-2">Revenue Breakdown</p>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80}>
            {data.map((_, idx) => (
              <Cell key={idx} fill={colors[idx % colors.length]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BarTrend({ data }: { data: { name: string; net: number }[] }) {
  return (
    <div className="glass p-4 rounded-xl h-64">
      <p className="text-sm text-muted-foreground mb-2">Net Profit Trend</p>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <XAxis dataKey="name" stroke={palette.gray} />
          <YAxis stroke={palette.gray} />
          <Tooltip />
          <Bar dataKey="net" fill={palette.red} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
