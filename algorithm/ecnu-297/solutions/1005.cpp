#include <iostream>
#include <queue>
#include <vector>
using namespace std;

int main() {
    int n;
    if (!(cin >> n)) return 0;
    queue<int> schools;
    vector<int> remaining(n);
    vector<vector<int>> seats(n);
    for (int i = 0; i < n; ++i) {
        cin >> remaining[i];
        remaining[i] *= 10;
        schools.push(i);
    }
    int seat = 0, previous = -1;
    while (!schools.empty()) {
        int school = schools.front();
        schools.pop();
        seat += school == previous ? 2 : 1;
        seats[school].push_back(seat);
        previous = school;
        if (--remaining[school] > 0) schools.push(school);
    }
    for (int school = 0; school < n; ++school) {
        cout << '#' << school + 1 << '\n';
        for (int i = 0; i < static_cast<int>(seats[school].size()); ++i) {
            if (i % 10 != 0) cout << ' ';
            cout << seats[school][i];
            if (i % 10 == 9) cout << '\n';
        }
    }
}
