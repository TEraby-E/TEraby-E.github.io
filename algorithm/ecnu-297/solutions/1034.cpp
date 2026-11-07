#include <iostream>
#include <string>
#include <vector>

using namespace std;

int priority(char op) {
    if (op == '~' || op == '#') return 3;
    if (op == '*' || op == '/') return 2;
    if (op == '+' || op == '-') return 1;
    return 0;
}

void calculate(vector<long long>& values, vector<char>& operators) {
    char op = operators.back();
    operators.pop_back();
    if (op == '~') {
        values.back() = -values.back();
    } else if (op != '#') {
        long long right = values.back();
        values.pop_back();
        long long& left = values.back();
        if (op == '+') left += right;
        else if (op == '-') left -= right;
        else if (op == '*') left *= right;
        else left /= right;
    }
}

int main() {
    string s;
    if (!(cin >> s)) return 0;
    vector<char> operators;
    vector<long long> values;
    bool needOperand = true;
    for (size_t i = 0; i < s.size();) {
        char ch = s[i];
        if (ch >= '0' && ch <= '9') {
            long long value = 0;
            while (i < s.size() && s[i] >= '0' && s[i] <= '9') {
                value = value * 10 + s[i++] - '0';
            }
            values.push_back(value);
            needOperand = false;
            continue;
        }
        ++i;
        if (ch == '(') {
            operators.push_back(ch);
        } else if (ch == ')') {
            while (operators.back() != '(') calculate(values, operators);
            operators.pop_back();
            needOperand = false;
        } else if (needOperand) {
            // 此处的正负号是一元运算，优先级比乘除高。
            operators.push_back(ch == '-' ? '~' : '#');
        } else {
            while (!operators.empty() && priority(operators.back()) >= priority(ch)) {
                calculate(values, operators);
            }
            operators.push_back(ch);
            needOperand = true;
        }
    }
    while (!operators.empty()) calculate(values, operators);
    cout << values.back() << '\n';
}
